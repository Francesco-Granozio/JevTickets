export type Department = 'billing' | 'technical' | 'account' | 'sales' | 'other' | string

export interface Analysis {
  department_probabilities: Record<string, number>
  department: Department
  confidence: number
  urgency_score: number
  refund_probability: number
  blocked_probability: number
  model_name: string
  analyzed_at: string
}

export interface Route {
  queue: string
  status: 'automatic' | 'human_review'
  priority: 'normal' | 'priority'
  reasons: string[]
}

export interface TicketSummary {
  id: number | string
  subject: string
  created_at: string
  source?: string
  expected_department?: string | null
  analysis: Analysis | null
  route: Route | null
}

export interface TicketDetail extends TicketSummary {
  message: string
}

export interface EvaluationDepartment {
  department: string
  total: number
  correct_auto: number
  incorrect_auto: number
  human_review: number
  pending?: number
}

export interface Evaluation {
  total: number
  analyzed: number
  correct_auto: number
  incorrect_auto: number
  human_review: number
  pending: number
  by_department: EvaluationDepartment[]
}

export interface Config {
  confidence_threshold: number
  blocked_threshold: number
}

const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, init)
  } catch {
    throw new Error('Cannot reach the API. Check that the backend is running.')
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const body = await response.json()
      detail = typeof body.detail === 'string' ? body.detail : detail
    } catch { /* keep the HTTP error */ }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})

export const api = {
  tickets: () => request<TicketSummary[]>('/tickets'),
  ticket: (id: number | string) => request<TicketDetail>(`/tickets/${encodeURIComponent(id)}`),
  create: (subject: string, message: string) => request<TicketDetail>('/tickets', json({ subject, message })),
  analyze: (id: number | string) => request<TicketDetail>(`/tickets/${encodeURIComponent(id)}/analyze`, { method: 'POST' }),
  importCsv: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ imported: number; skipped: number }>('/import', { method: 'POST', body })
  },
  evaluation: () => request<Evaluation>('/evaluation'),
  config: () => request<Config>('/config'),
  saveConfig: (value: Config) => request<Config>('/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  }),
}
