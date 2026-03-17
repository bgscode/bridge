// ─────────────────────────────────────────────────────────────────────────────
// Shared Types
// Ek jagah sab types — main process, preload, aur renderer sab yahan se import
// ─────────────────────────────────────────────────────────────────────────────

// ─── Group ───────────────────────────────────────────────────────────────────

export interface GroupRow {
  id: number
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export type CreateGroupDto = Pick<GroupRow, 'name' | 'description'>
export type UpdateGroupDto = Partial<CreateGroupDto>

// ─── Store ───────────────────────────────────────────────────────────────────

export interface StoreRow {
  id: number
  name: string
  code: string
  created_at: string
  updated_at: string
}

export type CreateStoreDto = Pick<StoreRow, 'name' | 'code'>
export type UpdateStoreDto = Partial<CreateStoreDto>

// ─── Fiscal Year ─────────────────────────────────────────────────────────────

export interface FiscalYearRow {
  id: number
  name: string
  created_at: string
  updated_at: string
}

export type CreateFiscalYearDto = Pick<FiscalYearRow, 'name'>
export type UpdateFiscalYearDto = Partial<CreateFiscalYearDto>

// ─── Connection ──────────────────────────────────────────────────────────────

export interface ConnectionRow {
  id: number
  name: string
  group_id: number | null
  static_ip: string
  vpn_ip: string
  db_name: string
  username: string
  password: string
  trust_cert: number
  fiscal_year_id: number | null
  store_id: number | null
  status: 'online' | 'offline' | 'failed' | 'unknown'
  created_at: string
  updated_at: string
}

export type CreateConnectionDto = Omit<ConnectionRow, 'id' | 'created_at' | 'updated_at'>
export type UpdateConnectionDto = Partial<Omit<ConnectionRow, 'id' | 'created_at' | 'updated_at'>>
