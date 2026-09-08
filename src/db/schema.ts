export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS external_managers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  country TEXT NOT NULL,
  worker_type TEXT NOT NULL DEFAULT 'employee' CHECK (worker_type IN ('employee', 'contractor')),
  end_date TEXT,
  manager_id TEXT REFERENCES employees(id) ON DELETE RESTRICT,
  external_manager_id TEXT REFERENCES external_managers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);

CREATE TABLE IF NOT EXISTS salary_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_year INTEGER NOT NULL,
  currency TEXT NOT NULL,
  base_salary REAL NOT NULL,
  bonus REAL NOT NULL DEFAULT 0,
  comp_ratio REAL,
  UNIQUE (employee_id, effective_year)
);

CREATE TABLE IF NOT EXISTS rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  rating_period TEXT NOT NULL CHECK (rating_period IN ('Most Recent', 'Prior Rating', 'Two Year Prior Rating')),
  rating_value TEXT NOT NULL,
  UNIQUE (employee_id, rating_period)
);
`;
