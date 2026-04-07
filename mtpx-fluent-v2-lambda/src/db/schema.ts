export type UserRow = {
  id: string;
  name: string;
  active: boolean;
  age: number;
  tier: string;
  created_at: string;
  [key: string]: unknown;
};

export type OrderRow = {
  id: string;
  user_id: string;
  status: string;
  total: number;
  created_at: string;
  [key: string]: unknown;
};

export type JobRow = {
  id: string;
  tenant_id: string;
  status: string;
  priority: number;
  attempt_count: number;
  created_at: string;
  [key: string]: unknown;
};

export type Schema = {
  users: UserRow;
  orders: OrderRow;
  jobs: JobRow;
  [key: string]: Record<string, unknown>;
};
