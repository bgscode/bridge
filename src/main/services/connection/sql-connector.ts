import { ConnectionRow } from '@shared/index'
import mssql, { config } from 'mssql'

export function buildConfig(
  conn: ConnectionRow,
  ip: string,
  port: number = 1433,
  timeoutSec: number = 15,
  requestTimeoutSec: number = 10
): config {
  const conf: config = {
    user: conn.username,
    server: ip,
    database: conn.db_name,
    password: conn.password,
    port: port,
    connectionTimeout: timeoutSec * 1000,
    requestTimeout: requestTimeoutSec * 1000,
    pool: {
      min: 0,
      max: 1,
      idleTimeoutMillis: 1000
    },
    options: {
      encrypt: conn.trust_cert ? true : false,
      trustServerCertificate: conn.trust_cert ? true : false
    }
  }
  return conf
}

function parseIp(value: string): { ip: string; port: number } {
  const [ip, portStr] = value.split(':')
  return { ip, port: portStr ? Number(portStr) : 1433 }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Connection failed'
}

export interface TestResult {
  success: boolean
  connectedVia: 'static_ip' | 'vpn_ip' | null
  error: string | null
}

export interface ConnectedPoolResult {
  pool: mssql.ConnectionPool
  connectedVia: 'static_ip' | 'vpn_ip'
}

interface ConnectionEndpoint {
  ip: string
  port: number
  via: 'static_ip' | 'vpn_ip'
}

function getConnectionEndpoints(conn: ConnectionRow): ConnectionEndpoint[] {
  const endpoints: ConnectionEndpoint[] = []

  if (conn.static_ip) {
    const { ip, port } = parseIp(conn.static_ip)
    endpoints.push({ ip, port, via: 'static_ip' })
  }

  if (conn.vpn_ip) {
    const { ip, port } = parseIp(conn.vpn_ip)
    endpoints.push({ ip, port, via: 'vpn_ip' })
  }

  return endpoints
}

async function connectToEndpoint(
  conn: ConnectionRow,
  ip: string,
  port: number,
  timeoutSec: number,
  requestTimeoutSec: number,
  via: 'static_ip' | 'vpn_ip'
): Promise<ConnectedPoolResult> {
  const pool = new mssql.ConnectionPool(buildConfig(conn, ip, port, timeoutSec, requestTimeoutSec))
  await pool.connect()
  return { pool, connectedVia: via }
}

export async function connectUsingBestIp(
  conn: ConnectionRow,
  timeoutSec: number = 15,
  requestTimeoutSec: number = 10
): Promise<ConnectedPoolResult> {
  const endpoints = getConnectionEndpoints(conn)

  if (endpoints.length === 0) {
    throw new Error('No connection IP configured')
  }

  const attempts = endpoints.map((endpoint) =>
    connectToEndpoint(conn, endpoint.ip, endpoint.port, timeoutSec, requestTimeoutSec, endpoint.via)
  )

  return new Promise((resolve, reject) => {
    let remaining = attempts.length
    const errors: string[] = []
    let settled = false

    for (const attempt of attempts) {
      attempt
        .then((result) => {
          if (settled) {
            result.pool.close().catch(() => {})
            return
          }

          settled = true
          resolve(result)
        })
        .catch((err) => {
          errors.push(getErrorMessage(err))
          remaining--

          if (!settled && remaining === 0) {
            reject(new Error(errors[errors.length - 1] ?? 'Connection failed'))
          }
        })
    }
  })
}

export async function testConnection(
  conn: ConnectionRow,
  timeoutSec: number = 15
): Promise<TestResult> {
  let connected: ConnectedPoolResult | null = null

  try {
    connected = await connectUsingBestIp(conn, timeoutSec, 10)
    await connected.pool.request().query('SELECT 1 AS test')
    return { success: true, connectedVia: connected.connectedVia, error: null }
  } catch (err) {
    return { success: false, connectedVia: null, error: getErrorMessage(err) }
  } finally {
    connected?.pool.close().catch(() => {})
  }
}
