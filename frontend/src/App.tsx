import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, Check, ChevronDown, CircleHelp,
  ClipboardList, Clock3, FileUp, Inbox, LoaderCircle, Plus, Search, Settings2,
  ShieldCheck, SlidersHorizontal, Sparkles, X,
} from 'lucide-react'
import { api } from './api'
import type { Config, Evaluation, TicketDetail, TicketSummary } from './api'

type Page = 'inbox' | 'evaluation'
type Filter = 'all' | 'priority' | 'review' | 'billing' | 'technical' | 'account'

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All tickets' },
  { key: 'priority', label: 'Priority' },
  { key: 'review', label: 'Human review' },
  { key: 'billing', label: 'Billing' },
  { key: 'technical', label: 'Technical' },
  { key: 'account', label: 'Account' },
]

const departments = ['billing', 'technical', 'account', 'sales', 'other']

function percent(value?: number | null) {
  return `${Math.round((value || 0) * 100)}%`
}

function title(value?: string | null) {
  if (!value) return 'Unassigned'
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const dateFormatter = new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' })

function date(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  return dateFormatter.format(parsed)
}

function Badge({ children, kind = 'plain' }: { children: ReactNode; kind?: 'plain' | 'coral' | 'dark' | 'green' }) {
  return <span className={`badge badge--${kind}`}>{children}</span>
}

function Metric({ label, value, note, dark = false, accent = false }: { label: string; value: string | number; note: string; dark?: boolean; accent?: boolean }) {
  return <div className={`metric ${dark ? 'metric--dark' : ''} ${accent ? 'metric--accent' : ''}`}>
    <div className="metric__label">{label}</div>
    <div className="metric__value">{value}</div>
    <div className="metric__note">{note}</div>
  </div>
}

function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle className="spin" size={size} aria-label="Loading" />
}

function Nav({ page, onPage, onNew, onSettings, config }: {
  page: Page; onPage: (page: Page) => void; onNew: () => void; onSettings: () => void; config: Config | null
}) {
  return <aside className="sidebar">
    <button className="brand" onClick={() => onPage('inbox')} aria-label="Support Triage home">
      <span className="brand__mark"><span></span><span></span><span></span><span></span></span>
      <span className="brand__name">triage<span className="brand__dot">.</span></span>
    </button>
    <div className="sidebar__section">WORKSPACE</div>
    <nav className="nav" aria-label="Main navigation">
      <button className={`nav__item ${page === 'inbox' ? 'is-active' : ''}`} onClick={() => onPage('inbox')}><Inbox size={18} /> Inbox <ArrowRight size={15} className="nav__arrow" /></button>
      <button className={`nav__item ${page === 'evaluation' ? 'is-active' : ''}`} onClick={() => onPage('evaluation')}><Activity size={18} /> Evaluation <ArrowRight size={15} className="nav__arrow" /></button>
    </nav>
    <button className="sidebar__new" onClick={onNew}><Plus size={18} /> New ticket</button>
    <div className="sidebar__bottom">
      <div className="sidebar__rule" />
      <div className="sidebar__section">HOW IT WORKS</div>
      <div className="sidebar__steps">
        <div><span>01</span> OpenJev judges</div>
        <div><span>02</span> Python applies policy</div>
        <div><span>03</span> Humans handle uncertainty</div>
      </div>
      <button className="sidebar__settings" onClick={onSettings}><Settings2 size={16} /> Routing settings <span>{config ? percent(config.confidence_threshold) : '—'}</span></button>
      <div className="sidebar__foot">OPENJEV V2 <span>•</span> SUPPORT TRIAGE MVP</div>
    </div>
  </aside>
}

function TicketRow({ ticket, selected, onClick }: { ticket: TicketSummary; selected: boolean; onClick: () => void }) {
  const route = ticket.route
  const analysis = ticket.analysis
  return <button className={`ticket-row ${selected ? 'is-selected' : ''}`} onClick={onClick}>
    <span className="ticket-row__first"><span className="ticket-row__id">#{String(ticket.id).padStart(3, '0')}</span><span className="ticket-row__subject">{ticket.subject}</span><span className="ticket-row__date">{date(ticket.created_at)}</span></span>
    <span className="ticket-row__second"><span className="ticket-row__department">{analysis ? title(analysis.department) : 'Awaiting analysis'}</span><span className="ticket-row__meta">{analysis ? `${percent(analysis.confidence)} confidence` : title(ticket.source || 'New ticket')}</span><span className="ticket-row__badges">{route?.priority === 'priority' && <Badge kind="coral">Priority</Badge>}{route?.status === 'human_review' ? <Badge kind="dark">Human review</Badge> : route ? <Badge kind="green">Auto routed</Badge> : <Badge>Pending</Badge>}</span></span>
  </button>
}

function ProbabilityBar({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return <div className={`probability ${highlight ? 'probability--highlight' : ''}`}>
    <span className="probability__label">{title(label)}</span>
    <div className="probability__track"><span style={{ width: percent(value) }} /></div>
    <strong>{percent(value)}</strong>
  </div>
}

function Signal({ label, value, copy }: { label: string; value: string; copy: string }) {
  return <div className="signal"><div className="signal__label">{label}</div><div className="signal__value">{value}</div><div className="signal__copy">{copy}</div></div>
}

function TicketDetailView({ ticket, config, analyzing, onAnalyze, onClose }: {
  ticket: TicketDetail; config: Config | null; analyzing: boolean; onAnalyze: () => void; onClose: () => void
}) {
  const analysis = ticket.analysis
  const route = ticket.route
  const probabilities = analysis?.department_probabilities || {}
  const ordered = [...new Set([...departments, ...Object.keys(probabilities)])]
  return <section className="detail" aria-label="Ticket detail">
    <div className="detail__top"><span>SELECTED TICKET <span className="detail__number">#{String(ticket.id).padStart(3, '0')}</span></span><button className="icon-button" onClick={onClose} aria-label="Close ticket"><X size={18} /></button></div>
    <div className="detail__body">
      <div className="detail__eyebrow">{title(ticket.source || 'Support')} / {date(ticket.created_at)}</div>
      <h2>{ticket.subject}</h2>
      <div className="detail__message">{ticket.message}</div>
      {!analysis && <div className="detail__pending"><Sparkles size={22} /><h3>Ready for a decision</h3><p>Run this ticket through OpenJev and the routing policy to reveal its destination.</p><button className="button button--dark" onClick={onAnalyze} disabled={analyzing}>{analyzing ? <Spinner /> : <Sparkles size={16} />}{analyzing ? 'Analyzing…' : 'Analyze ticket'}</button></div>}
      {analysis && <>
        <div className="detail__division"><span>01 / MODEL JUDGMENT</span><span>{analysis.model_name || 'OpenJev v2'}</span></div>
        <div className="decision-head"><span>Department distribution</span><strong>{title(analysis.department)} <span>{percent(analysis.confidence)}</span></strong></div>
        <div className="probabilities">{ordered.map(key => <ProbabilityBar key={key} label={key} value={probabilities[key] || 0} highlight={key.toLowerCase() === analysis.department.toLowerCase()} />)}</div>
        <p className="score-note">Model scores normalized across departments; not calibrated probabilities.</p>
        <div className="signal-grid">
          <Signal label="URGENCY" value={`${Math.round(analysis.urgency_score)} / 3`} copy={['Can wait', 'Normal', 'Needs attention today', 'Critical'][Math.max(0, Math.min(3, Math.round(analysis.urgency_score)))]} />
          <Signal label="REFUND REQUESTED" value={percent(analysis.refund_probability)} copy="Relative model score" />
          <Signal label="CUSTOMER BLOCKED" value={percent(analysis.blocked_probability)} copy="Relative model score" />
        </div>
        <div className="detail__division"><span>02 / SOFTWARE POLICY</span><span>DETERMINISTIC RULES</span></div>
        <div className={`route ${route?.status === 'human_review' ? 'route--review' : ''}`}>
          <div className="route__icon">{route?.status === 'human_review' ? <CircleHelp size={22} /> : <ArrowDownRight size={23} />}</div>
          <div><div className="route__eyebrow">FINAL ROUTE</div><div className="route__name">{route?.status === 'human_review' ? 'Human review' : route ? title(route.queue) : 'Awaiting route'}</div><div className="route__sub">{route?.status === 'human_review' ? 'A person checks this decision before routing.' : route?.priority === 'priority' ? 'Priority queue' : 'Standard queue'}</div></div>
          {route && <Badge kind={route.status === 'human_review' ? 'dark' : 'coral'}>{route.status === 'human_review' ? 'REVIEW' : route.priority.toUpperCase()}</Badge>}
        </div>
        <div className="rule-list"><div className="rule-list__head">WHY THIS ROUTE</div>{route?.reasons?.length ? route.reasons.map(reason => <div className="rule-list__item" key={reason}><Check size={14} />{reason}</div>) : <div className="rule-list__item">No routing explanation available.</div>}</div>
        {config && <div className="threshold"><SlidersHorizontal size={15} /><span>Confidence threshold</span><strong>{percent(config.confidence_threshold)}</strong></div>}
      </>}
    </div>
  </section>
}

function NewTicketDialog({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (subject: string, message: string) => Promise<void>; busy: boolean }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (subject.trim() && message.trim()) await onSubmit(subject.trim(), message.trim()) }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-ticket-title">
    <div className="dialog__top"><span>NEW TICKET / 01</span><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <h2 id="new-ticket-title">What happened?</h2><p>Enter a customer request. The model will judge it, then the backend will apply routing rules.</p>
    <form onSubmit={submit}><label htmlFor="subject">SUBJECT</label><input id="subject" autoFocus maxLength={180} placeholder="e.g. Charged twice for my subscription" value={subject} onChange={event => setSubject(event.target.value)} required />
      <label htmlFor="message">MESSAGE</label><textarea id="message" rows={7} placeholder="Describe the customer’s issue…" value={message} onChange={event => setMessage(event.target.value)} required />
      <div className="dialog__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--coral" disabled={busy || !subject.trim() || !message.trim()} type="submit">{busy ? <Spinner /> : <Sparkles size={16} />}{busy ? 'Analyzing…' : 'Analyze ticket'}<ArrowRight size={16} /></button></div>
    </form>
  </section></div>
}

function SettingsDialog({ value, onClose, onSave, busy }: { value: Config; onClose: () => void; onSave: (value: Config) => Promise<void>; busy: boolean }) {
  const [confidence, setConfidence] = useState(() => Math.round(value.confidence_threshold * 100))
  const [blocked, setBlocked] = useState(() => Math.round(value.blocked_threshold * 100))
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave({ confidence_threshold: confidence / 100, blocked_threshold: blocked / 100 }) }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="dialog dialog--settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div className="dialog__top"><span>ROUTING POLICY / CONFIG</span><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <h2 id="settings-title">Set the threshold.</h2><p>These values are applied by the backend after OpenJev makes its judgment. Changing them immediately recalculates routes for analyzed tickets.</p>
    <form onSubmit={submit}><div className="range-heading"><label htmlFor="confidence">MINIMUM DEPARTMENT CONFIDENCE</label><strong>{confidence}%</strong></div><input id="confidence" className="range" type="range" min="0" max="100" value={confidence} onChange={event => setConfidence(Number(event.target.value))} /><div className="range-note">Below this score, a ticket goes to human review.</div>
      <div className="range-heading"><label htmlFor="blocked">BLOCKED CUSTOMER THRESHOLD</label><strong>{blocked}%</strong></div><input id="blocked" className="range" type="range" min="0" max="100" value={blocked} onChange={event => setBlocked(Number(event.target.value))} /><div className="range-note">At or above this score, the ticket enters the priority queue.</div>
      <div className="dialog__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--dark" disabled={busy} type="submit">{busy ? <Spinner /> : <Check size={16} />} Save policy</button></div>
    </form>
  </section></div>
}

function EvaluationView({ value, loading, error, onRefresh }: { value: Evaluation | null; loading: boolean; error: string | null; onRefresh: () => void }) {
  const autoRoutes = value ? value.correct_auto + value.incorrect_auto : 0
  const correctRate = value && autoRoutes > 0 ? Math.round(value.correct_auto / autoRoutes * 100) : 0
  return <div className="page-inner"><header className="page-head"><div><div className="eyebrow">MODEL OBSERVATORY / 02</div><h1>evaluation<span>.</span></h1><p>A practical check of routing behavior on labeled demo tickets.</p></div><button className="button button--outline" onClick={onRefresh} disabled={loading}>{loading ? <Spinner /> : <Activity size={16} />} Refresh results</button></header>
    {error && <div className="notice notice--error">{error} <button onClick={onRefresh}>Retry</button></div>}
    <div className="metrics metrics--evaluation"><Metric label="TICKETS IN SET" value={value?.total ?? '—'} note="Labeled examples" dark /><Metric label="CORRECT AUTO ROUTES" value={value?.correct_auto ?? '—'} note={`${correctRate}% of automatic routes`} dark /><Metric label="HUMAN REVIEW" value={value?.human_review ?? '—'} note="Uncertain decisions" accent /><Metric label="INCORRECT AUTO ROUTES" value={value?.incorrect_auto ?? '—'} note="Requires inspection" /></div>
    <section className="evaluation-panel"><div className="section-title"><div><span className="eyebrow">BREAKDOWN / DEPARTMENT</span><h2>Where decisions land</h2></div><span className="section-title__meta">{value?.analyzed ?? 0} ANALYZED / {value?.pending ?? 0} PENDING</span></div>
      {loading && !value ? <div className="empty"><Spinner size={24} /> Loading evaluation…</div> : value?.by_department?.length ? <div className="eval-table"><div className="eval-table__head"><span>EXPECTED DEPARTMENT</span><span>TOTAL</span><span>CORRECT AUTO</span><span>HUMAN REVIEW</span><span>INCORRECT AUTO</span></div>{value.by_department.map(row => <div className="eval-table__row" key={row.department}><strong>{title(row.department)}</strong><span>{row.total}</span><span>{row.correct_auto}</span><span>{row.human_review}</span><span className={row.incorrect_auto > 0 ? 'text-coral' : ''}>{row.incorrect_auto}</span></div>)}</div> : <div className="empty"><ClipboardList size={26} /><strong>No evaluation data yet</strong><span>Import labeled tickets and analyze them to see this breakdown.</span></div>}</section>
    <div className="evaluation-note"><ShieldCheck size={18} /><p>This is a small, labeled demo set used to inspect the MVP’s behavior. It is not a scientific benchmark of OpenJev.</p></div>
  </div>
}

export default function App() {
  const [page, setPage] = useState<Page>('inbox')
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | string | null>(null)
  const [detail, setDetail] = useState<TicketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState<Config | null>(null)
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [evaluationLoading, setEvaluationLoading] = useState(false)
  const [evaluationError, setEvaluationError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedIdRef = useRef<number | string | null>(null)
  const selectTicket = (id: number | string | null) => { selectedIdRef.current = id; setSelectedId(id) }

  const loadTickets = useCallback(async () => {
    setLoading(true); setError(null)
    try { setTickets((await api.tickets()).sort((a, b) => new Date(b.created_at).valueOf() - new Date(a.created_at).valueOf())) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load tickets.') } finally { setLoading(false) }
  }, [])
  const loadEvaluation = useCallback(async () => {
    setEvaluationLoading(true); setEvaluationError(null)
    try { setEvaluation(await api.evaluation()) } catch (cause) { setEvaluationError(cause instanceof Error ? cause.message : 'Could not load evaluation.') } finally { setEvaluationLoading(false) }
  }, [])

  useEffect(() => { void loadTickets(); void api.config().then(setConfig).catch(() => {}) }, [loadTickets])
  useEffect(() => { if (page === 'evaluation') void loadEvaluation() }, [page, loadEvaluation])
  useEffect(() => {
    if (!newOpen && !settingsOpen && selectedId === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (newOpen) setNewOpen(false)
      else if (settingsOpen) setSettingsOpen(false)
      else { selectedIdRef.current = null; setSelectedId(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newOpen, settingsOpen, selectedId])
  useEffect(() => {
    if (selectedId === null) { setDetail(null); return }
    let active = true
    setDetail(null); setDetailLoading(true)
    void api.ticket(selectedId).then(value => { if (active) setDetail(previous => previous?.id === value.id && previous.analysis && !value.analysis ? previous : value) }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load ticket.') }).finally(() => { if (active) setDetailLoading(false) })
    return () => { active = false }
  }, [selectedId])

  const refreshSelected = async (value: TicketDetail) => { if (selectedIdRef.current === value.id) setDetail(value); await loadTickets() }
  const analyze = async (id: number | string) => {
    setBusy(true); setError(null)
    try { await refreshSelected(await api.analyze(id)) } catch (cause) { if (selectedIdRef.current === id) setError(cause instanceof Error ? cause.message : 'Analysis failed.') } finally { setBusy(false) }
  }
  const create = async (subject: string, message: string) => {
    setBusy(true); setError(null)
    try {
      const created = await api.create(subject, message)
      setNewOpen(false); setPage('inbox'); selectTicket(created.id); setDetail(created)
      await loadTickets()
      await analyze(created.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create ticket.'); setBusy(false) }
  }
  const importCsv = async (file?: File) => {
    if (!file) return
    setBusy(true); setError(null)
    try { const result = await api.importCsv(file); setNotice(`${result.imported} tickets imported${result.skipped ? ` · ${result.skipped} skipped` : ''}.`); await loadTickets() } catch (cause) { setError(cause instanceof Error ? cause.message : 'CSV import failed.') } finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  const saveConfig = async (value: Config) => {
    setBusy(true); setError(null)
    try {
      setConfig(await api.saveConfig(value)); setSettingsOpen(false); setNotice('Routing policy updated.')
      await loadTickets()
      if (selectedId !== null) setDetail(await api.ticket(selectedId))
      if (page === 'evaluation') await loadEvaluation()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save policy.') } finally { setBusy(false) }
  }
  const totals = { total: tickets.length, priority: tickets.filter(ticket => ticket.route?.priority === 'priority').length, review: tickets.filter(ticket => ticket.route?.status === 'human_review').length, analyzed: tickets.filter(ticket => !!ticket.analysis).length }
  const shown = tickets.filter(ticket => {
    const textMatches = `${ticket.subject} ${ticket.analysis?.department || ''} ${ticket.id}`.toLowerCase().includes(query.trim().toLowerCase())
    if (!textMatches) return false
    if (filter === 'priority') return ticket.route?.priority === 'priority'
    if (filter === 'review') return ticket.route?.status === 'human_review'
    if (filter !== 'all') return ticket.analysis?.department?.toLowerCase() === filter
    return true
  })

  return <div className="app"><Nav page={page} onPage={next => { setPage(next); selectTicket(null) }} onNew={() => setNewOpen(true)} onSettings={() => setSettingsOpen(true)} config={config} />
    <main className="main">{page === 'evaluation' ? <EvaluationView value={evaluation} loading={evaluationLoading} error={evaluationError} onRefresh={() => void loadEvaluation()} /> : <div className="page-inner"><header className="page-head"><div><div className="eyebrow">SUPPORT OPERATIONS / LIVE WORKSPACE</div><h1>make the right call<span>.</span></h1><p>Structured judgment for every ticket. Clear policy for every route.</p></div><div className="page-head__actions"><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={event => void importCsv(event.target.files?.[0])} /><button className="button button--outline" onClick={() => fileRef.current?.click()} disabled={busy}><FileUp size={16} /> Import CSV</button><button className="button button--dark" onClick={() => setNewOpen(true)}><Plus size={17} /> New ticket</button></div></header>
      {error && <div className="notice notice--error">{error} <button onClick={() => { setError(null); void loadTickets() }}>Retry</button></div>}
      {notice && <div className="notice notice--success"><Check size={16} />{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={15} /></button></div>}
      <div className="metrics"><Metric label="TOTAL TICKETS" value={totals.total} note="Across all departments" dark /><Metric label="ANALYZED" value={totals.analyzed} note="With model decisions" dark /><Metric label="PRIORITY QUEUE" value={totals.priority} note="Needs attention" accent /><Metric label="HUMAN REVIEW" value={totals.review} note="Uncertain routes" /></div>
      <div className="workspace"><section className="inbox-panel"><div className="section-title"><div><span className="eyebrow">INBOX / {shown.length} TICKETS</span><h2>Ticket queue</h2></div><span className="section-title__meta">SORTED BY LATEST <ChevronDown size={14} /></span></div>
        <div className="toolbar"><div className="filters">{filters.map(item => <button key={item.key} className={`filter ${filter === item.key ? 'is-active' : ''}`} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div><label className="search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tickets" aria-label="Search tickets" /></label></div>
        <div className="list-head"><span>TICKET / SUBJECT</span><span>DECISION / ROUTE</span></div>
        <div className="ticket-list">{loading && !tickets.length ? <div className="empty"><Spinner size={24} /> Loading tickets…</div> : shown.length ? shown.map(ticket => <TicketRow key={ticket.id} ticket={ticket} selected={selectedId === ticket.id} onClick={() => selectTicket(ticket.id)} />) : <div className="empty"><Inbox size={26} /><strong>{tickets.length ? 'No matching tickets' : 'Your inbox is empty'}</strong><span>{tickets.length ? 'Try another search or filter.' : 'Import the demo CSV or create a ticket to begin.'}</span>{!tickets.length && <button className="button button--coral" onClick={() => fileRef.current?.click()}>Import CSV <ArrowRight size={15} /></button>}</div>}</div>
      </section><aside className="insight-panel"><div className="insight-panel__top"><span>TRIAGE AT A GLANCE</span><Sparkles size={16} /></div><h3>Judgment.<br />Policy.<br /><em>Clarity.</em></h3><p>OpenJev estimates intent and urgency. Your routing rules decide the next action. Uncertain cases stay with a person.</p><div className="insight-panel__graphic"><div><span>MODEL CONFIDENCE</span><strong>{totals.analyzed ? percent(tickets.reduce((sum, ticket) => sum + (ticket.analysis?.confidence || 0), 0) / totals.analyzed) : '—'}</strong></div><div className="insight-panel__line"><span style={{ width: totals.analyzed ? percent(tickets.reduce((sum, ticket) => sum + (ticket.analysis?.confidence || 0), 0) / totals.analyzed) : '0%' }} /></div></div><div className="insight-panel__foot"><Clock3 size={16} /> Review before automation when confidence falls short.</div></aside></div>
    </div>}</main>
    {(detail || detailLoading) && page === 'inbox' && <div className="detail-shell">{detailLoading && !detail ? <div className="detail-loading"><Spinner size={24} /> Loading ticket…</div> : detail && <TicketDetailView ticket={detail} config={config} analyzing={busy} onAnalyze={() => void analyze(detail.id)} onClose={() => selectTicket(null)} />}</div>}
    {newOpen && <NewTicketDialog onClose={() => setNewOpen(false)} onSubmit={create} busy={busy} />}
    {settingsOpen && config && <SettingsDialog value={config} onClose={() => setSettingsOpen(false)} onSave={saveConfig} busy={busy} />}
    {settingsOpen && !config && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><div className="dialog dialog--settings" onMouseDown={event => event.stopPropagation()}><div className="dialog__top"><span>ROUTING POLICY</span><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close"><X size={20} /></button></div><h2>Settings unavailable</h2><p>Connect the backend to edit routing thresholds.</p></div></div>}
    {error && (detail || detailLoading || newOpen || settingsOpen) && <div className="global-error" role="alert"><span>{error}</span>{detail && !detail.analysis && <button onClick={() => void analyze(detail.id)} disabled={busy}>Retry analysis</button>}<button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={16} /></button></div>}
    <div className="mobile-nav"><button onClick={() => { setPage('inbox'); selectTicket(null) }} className={page === 'inbox' ? 'is-active' : ''}><Inbox size={19} /> Inbox</button><button onClick={() => { setPage('evaluation'); selectTicket(null) }} className={page === 'evaluation' ? 'is-active' : ''}><Activity size={19} /> Evaluation</button><button onClick={() => setSettingsOpen(true)}><Settings2 size={19} /> Policy</button><button onClick={() => setNewOpen(true)}><Plus size={19} /> New</button></div>
  </div>
}
