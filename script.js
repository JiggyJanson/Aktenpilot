const STORAGE_KEY = "aktenpilot-data-v1";
const defaultState = { cases: [], documents: [], uploads: [], selectedCaseId: null };
let state = loadState();
let currentView = "dashboard";
let analysisQueue = Promise.resolve();
const queuedAnalysisIds = new Set();
let mobileCaseDetailOpen = false;
let completedCasesExpanded = false;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const cases = Array.isArray(saved?.cases) ? saved.cases.map(caseRecord => {
      const legacyAutoCase = caseRecord.title?.startsWith("Erkannter Fall:");
      return { ...caseRecord, title: legacyAutoCase ? caseRecord.title.replace(/^Erkannter Fall:\s*/, "") : caseRecord.title, generatedByAnalysis: caseRecord.generatedByAnalysis || legacyAutoCase || Boolean(caseRecord.autoKey) };
    }) : [];
    return { ...defaultState, ...saved, cases, uploads: Array.isArray(saved?.uploads) ? saved.uploads : [] };
  }
  catch { return { ...defaultState }; }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function esc(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
function dateValue(value) { return value ? new Date(`${value}T12:00:00`) : null; }
function formatDate(value) { if (!value) return "–"; return dateValue(value).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }); }
function formatShortDate(value) { if (!value) return "–"; return dateValue(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); }
function formatActivityDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Gerade eben" : date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" }); }
function formatFileSize(bytes = 0) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`; }
function statusLabel(status) { return { open: "Offen", progress: "In Arbeit", done: "Erledigt" }[status] || "Offen"; }
function uploadStatusLabel(status) { return { queued: "Bereit zur Analyse", waiting: "In Analyse-Warteschlange", analyzing: "Wird analysiert …", analyzed: "Analysiert", unsupported: "Nicht unterstützt", error: "Analyse fehlgeschlagen" }[status] || "Bereit zur Analyse"; }
function priorityLabel(priority) { return { high: "Hoch", medium: "Mittel", low: "Niedrig" }[priority] || "Mittel"; }
function getCase(id) { return state.cases.find(c => c.id === id); }
function isMobileViewport() { return window.matchMedia("(max-width: 700px)").matches; }
function isAutoCase(caseRecord) { return Boolean(caseRecord?.generatedByAnalysis || caseRecord?.autoKey); }
function caseTitleHtml(caseRecord) { return `<span class="case-title-text">${esc(caseRecord.title)}</span>${isAutoCase(caseRecord) ? '<span class="auto-badge" title="Automatisch erstellt">⚡ Auto</span>' : ""}`; }
function caseMobileSummary(caseRecord) {
  const documents = documentsFor(caseRecord.id);
  const deadline = documents.filter(deadlineActive).map(document => document.deadline).sort()[0] || "";
  const priorities = documents.map(document => document.priority).filter(Boolean);
  let priority = priorities.includes("high") ? "high" : priorities.includes("medium") ? "medium" : "low";
  if (deadline && daysUntil(deadline) < 0) priority = "high";
  return { priority, deadline, tone: deadline ? deadlineTone(deadline) : "none" };
}
function caseDeadlineRank(caseRecord) {
  const deadline = documentsFor(caseRecord.id).filter(deadlineActive).map(document => document.deadline).sort()[0] || "";
  if (!deadline) return { rank: 2, deadline: "" };
  const days = daysUntil(deadline);
  return { rank: days < 0 ? 0 : days <= 7 ? 1 : 2, deadline };
}
function sortCasesForWorklist(cases) {
  return [...cases].sort((a, b) => {
    const aRank = caseDeadlineRank(a); const bRank = caseDeadlineRank(b);
    if (aRank.rank !== bRank.rank) return aRank.rank - bRank.rank;
    if (aRank.deadline && bRank.deadline) return dateValue(aRank.deadline) - dateValue(bRank.deadline);
    if (aRank.deadline) return -1;
    if (bRank.deadline) return 1;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}
function documentsFor(caseId) { return state.documents.filter(d => d.caseId === caseId); }
function daysUntil(date) { return Math.ceil((dateValue(date) - new Date(new Date().toDateString())) / 86400000); }
function deadlineText(date) { const days = daysUntil(date); if (days < 0) return `${Math.abs(days)} T. überfällig`; if (days === 0) return "Heute fällig"; if (days === 1) return "Morgen fällig"; return `in ${days} Tagen`; }
function deadlineClass(date) { return daysUntil(date) < 0 ? "overdue" : ""; }
function deadlineTone(date) { const days = daysUntil(date); return days < 0 ? "overdue" : days <= 7 ? "soon" : "safe"; }
function deadlineActive(doc) { return doc.deadline && doc.status !== "done"; }
function empty(text, detail = "") { return `<div class="empty"><strong>${esc(text)}</strong>${esc(detail)}</div>`; }

function render() {
  renderNavigation(); renderDashboard(); renderCases(); renderDocuments(); renderUploadQueue();
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `${currentView}-view`));
}
function renderUploadQueue() {
  const queue = document.getElementById("uploadQueue");
  if (!queue) return;
  queue.innerHTML = state.uploads.length ? state.uploads.map(upload => {
    const canAnalyze = upload.status === "queued" || upload.status === "error";
    const isBusy = upload.status === "waiting" || upload.status === "analyzing";
    const result = upload.analysisResult;
    return `<article class="upload-item ${result ? "has-result" : ""}"><div class="file-icon">${upload.kind === "pdf" ? "PDF" : "IMG"}</div><div class="upload-copy"><strong>${esc(upload.name)}</strong><span>${esc(upload.type || "Unbekannter Typ")} · ${formatFileSize(upload.size)}</span></div><span class="analysis-status ${upload.status}">${uploadStatusLabel(upload.status)}</span><div class="upload-actions">${canAnalyze ? `<button class="button secondary small-button" data-analyze-upload="${upload.id}" type="button">Analysieren</button>` : ""}${upload.status === "analyzed" ? `<button class="button secondary small-button" data-reset-upload="${upload.id}" type="button">Zurücksetzen</button>` : ""}${upload.caseId && !isBusy ? `<button class="table-action" data-case-id="${upload.caseId}">Fall öffnen</button>` : ""}<button class="icon-button delete-upload" data-delete-upload="${upload.id}" type="button" ${isBusy ? "disabled title='Analyse läuft'" : "title='Upload löschen'"}>×</button></div>${result ? `<div class="analysis-result"><div class="analysis-result-head"><strong>Analyseergebnis <span class="analysis-provider">Simulation</span></strong><span class="priority ${result.priority}">Priorität: ${priorityLabel(result.priority)}</span></div><div class="analysis-result-grid"><span><b>Typ</b>${esc(result.documentType)}</span><span><b>Erkanntes Datum</b>${formatDate(result.documentDate)}</span><span><b>Frist</b>${result.deadline ? formatDate(result.deadline) : "Keine erkannt"}</span><span><b>Zuordnung</b>${esc(result.caseTitle)}</span></div><p>${esc(result.summary)}</p></div>` : ""}</article>`;
  }).join("") : `<div class="upload-empty">Noch keine Dateien ausgewählt.</div>`;
  document.getElementById("analyzeAll").disabled = !state.uploads.some(upload => upload.status === "queued" || upload.status === "error");
}
function renderNavigation() { document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === currentView)); }
function renderDashboard() {
  const activeDeadlines = state.documents.filter(deadlineActive).sort((a,b) => dateValue(a.deadline) - dateValue(b.deadline));
  const openCases = state.cases.filter(c => c.status !== "done").length;
  const dueSoon = activeDeadlines.filter(d => daysUntil(d.deadline) <= 7).length;
  document.getElementById("statCards").innerHTML = [
    [state.cases.length, "Fälle insgesamt", "◫", "", "cases"], [openCases, "Aktive Fälle", "◌", "", "cases"],
    [dueSoon, "Fristen in 7 Tagen", "◷", dueSoon ? "warn" : "", "documents"], [activeDeadlines.filter(d => daysUntil(d.deadline) < 0).length, "Überfällige Fristen", "!", activeDeadlines.some(d => daysUntil(d.deadline) < 0) ? "danger" : "", "documents"]
  ].map(([number, label, icon, className, target]) => `<button class="stat-card stats-link ${className}" data-view-target="${target}" type="button" aria-label="${label} öffnen"><div class="stat-label"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${number}</div><div class="stat-sub">${number === 1 ? "Eintrag" : "Einträge"} · Öffnen →</div></button>`).join("");
  document.getElementById("deadlineList").innerHTML = activeDeadlines.length ? activeDeadlines.slice(0,6).map(d => {
    const c = getCase(d.caseId); const date = dateValue(d.deadline);
    const tone = deadlineTone(d.deadline);
    return `<article class="deadline-item ${tone}" data-case-id="${d.caseId || ""}"><div class="deadline-date"><strong>${date.getDate()}</strong>${date.toLocaleDateString("de-DE", { month:"short" })}</div><div class="deadline-copy"><b>${esc(d.title)}</b><span>${c ? esc(c.title) : "Nicht zugeordnet"}</span></div><span class="urgency ${tone}">${deadlineText(d.deadline)}</span></article>`;
  }).join("") : empty("Keine offenen Fristen", "Fristen aus Dokumenten erscheinen hier automatisch.");
  const cases = state.cases.filter(c => c.status !== "done").sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  document.getElementById("recentCases").innerHTML = cases.length ? cases.slice(0,6).map(c => `<article class="recent-case" data-case-id="${c.id}"><div class="case-initial">${esc(c.title.charAt(0).toUpperCase())}</div><div style="min-width:0"><span class="case-name">${caseTitleHtml(c)}</span><small>${c.reference ? esc(c.reference) : c.party ? esc(c.party) : "Ohne Aktenzeichen"}</small></div><span class="status ${c.status}">${statusLabel(c.status)}</span></article>`).join("") : empty("Noch keine Fälle", "Legen Sie Ihren ersten Fall an, um zu starten.");
  const urgentCases = state.cases.map(c => ({ caseRecord: c, deadline: documentsFor(c.id).filter(deadlineActive).map(d => d.deadline).sort()[0] })).filter(item => item.deadline && daysUntil(item.deadline) <= 7).sort((a,b) => dateValue(a.deadline) - dateValue(b.deadline));
  document.getElementById("urgentCases").innerHTML = urgentCases.length ? urgentCases.slice(0,4).map(({ caseRecord, deadline }) => `<article class="urgent-case" data-case-id="${caseRecord.id}"><div class="urgent-indicator ${deadlineTone(deadline)}"></div><div><span class="case-name">${caseTitleHtml(caseRecord)}</span><small>${deadlineText(deadline)} · Frist ${formatDate(deadline)}</small></div><span class="arrow">→</span></article>`).join("") : empty("Alles im grünen Bereich", "Derzeit stehen keine Fristen innerhalb der nächsten sieben Tage an.");
  const activities = [
    ...state.documents.map(document => ({ date: document.createdAt || document.date, title: "Dokument abgelegt", detail: document.title, caseId: document.caseId, icon: "▤" })),
    ...state.cases.map(caseRecord => ({ date: caseRecord.updatedAt || caseRecord.createdAt, title: "Fall aktualisiert", detail: caseRecord.title, caseId: caseRecord.id, icon: "◫" }))
  ].sort((a,b) => new Date(b.date) - new Date(a.date));
  document.getElementById("activityList").innerHTML = activities.length ? activities.slice(0,5).map(activity => `<article class="activity-item" data-case-id="${activity.caseId || ""}"><span class="activity-icon">${activity.icon}</span><div><strong>${esc(activity.title)}</strong><span>${esc(activity.detail)}</span></div><time>${formatActivityDate(activity.date)}</time></article>`).join("") : empty("Noch keine Aktivitäten", "Erfasste Dokumente und bearbeitete Fälle erscheinen hier.");
}
function renderCases() {
  const casesView = document.getElementById("cases-view");
  casesView.classList.toggle("mobile-case-detail", isMobileViewport() && mobileCaseDetailOpen);
  const query = document.getElementById("caseSearch").value.toLowerCase();
  const filtered = state.cases.filter(c => `${c.title} ${c.reference} ${c.party}`.toLowerCase().includes(query));
  if (!state.selectedCaseId && state.cases[0]) state.selectedCaseId = state.cases[0].id;
  if (!getCase(state.selectedCaseId)) state.selectedCaseId = state.cases[0]?.id || null;
  const caseCard = c => { const summary = caseMobileSummary(c); return `<article class="case-row ${c.id === state.selectedCaseId ? "selected" : ""}" data-case-id="${c.id}"><div class="case-row-top"><span class="case-name">${caseTitleHtml(c)}</span><span class="status ${c.status}">${statusLabel(c.status)}</span></div><small>${esc(c.reference || c.party || "Keine zusätzlichen Angaben")}</small><div class="mobile-case-meta"><span class="mobile-priority ${summary.priority}">Priorität: ${priorityLabel(summary.priority)}</span><span class="mobile-deadline ${summary.tone}">${summary.deadline ? `Frist ${formatShortDate(summary.deadline)}` : "Keine Frist"}</span><span class="mobile-reference">${esc(c.reference || "Ohne Aktenzeichen")}</span></div></article>`; };
  const groups = [
    { status: "progress", title: "In Arbeit", description: "Aktiv bearbeitete Fälle" },
    { status: "open", title: "Offen", description: "Noch nicht begonnene Fälle" },
    { status: "done", title: "Erledigt", description: "Abgeschlossene Fälle", collapsible: true }
  ];
  document.getElementById("caseList").innerHTML = groups.map(group => {
    const casesInGroup = sortCasesForWorklist(filtered.filter(c => c.status === group.status));
    const collapsed = group.collapsible && !completedCasesExpanded;
    const heading = group.collapsible ? `<button class="case-group-toggle" data-toggle-completed type="button" aria-expanded="${!collapsed}"><span><b>${group.title}</b><small>${collapsed ? "Erledigte Fälle anzeigen" : group.description}</small></span><span class="case-group-count">${casesInGroup.length}</span><span class="toggle-chevron">${collapsed ? "⌄" : "⌃"}</span></button>` : `<div class="case-group-heading"><span><b>${group.title}</b><small>${group.description}</small></span><span class="case-group-count">${casesInGroup.length}</span></div>`;
    return `<section class="case-group ${group.status} ${collapsed ? "collapsed" : ""}">${heading}<div class="case-group-content">${casesInGroup.length ? casesInGroup.map(caseCard).join("") : `<p class="case-group-empty">Keine Fälle in diesem Bereich.</p>`}</div></section>`;
  }).join("");
  const c = getCase(state.selectedCaseId); const detail = document.getElementById("caseDetail");
  if (!c) { detail.innerHTML = empty("Noch kein Fall ausgewählt", "Legen Sie einen Fall an, um eine Zeitleiste aufzubauen."); return; }
  const docs = documentsFor(c.id).sort((a,b) => dateValue(b.date) - dateValue(a.date));
  const notes = c.notes || [];
  const mobileSummary = caseMobileSummary(c);
  const mobileDetails = `<section class="mobile-case-overview"><div><span>Priorität</span><b class="${mobileSummary.priority}">${priorityLabel(mobileSummary.priority)}</b></div><div><span>Nächste Frist</span><b class="${mobileSummary.tone}">${mobileSummary.deadline ? formatDate(mobileSummary.deadline) : "Keine Frist"}</b></div><div><span>Aktenzeichen</span><b>${esc(c.reference || "–")}</b></div></section><section class="mobile-documents-section"><div class="mobile-section-header"><h3>Dokumente</h3><span>${docs.length}</span></div>${docs.length ? docs.map(d => `<article class="mobile-document-row"><span class="mobile-document-icon">▤</span><div><b>${esc(d.title)}</b><small>${esc(d.type)} · ${formatDate(d.date)}</small></div></article>`).join("") : '<p class="mobile-empty-copy">Noch keine Dokumente zugeordnet.</p>'}</section>`;
  detail.innerHTML = `<header class="case-detail-head"><div><button class="mobile-back" data-close-case-detail type="button">← Alle Fälle</button><h2 class="case-title">${caseTitleHtml(c)}</h2><div class="case-meta">${c.reference ? `<span class="case-reference">Aktenzeichen · ${esc(c.reference)}</span>` : ""}${c.party ? `<span class="case-party">${esc(c.party)}</span>` : `<span class="case-party">Keine Beteiligten hinterlegt</span>`}<span>Erstellt am ${formatDate(c.createdAt.slice(0,10))}</span></div>${isAutoCase(c) ? '<p class="auto-case-hint">⚡ Automatisch erstellt – Angaben bitte prüfen</p>' : ""}</div><div class="case-detail-actions"><button class="status ${c.status}" data-cycle-status="${c.id}" title="Status ändern">${statusLabel(c.status)}</button><button class="icon-button" data-add-note="${c.id}">＋ Notiz</button></div></header>${mobileDetails}<div class="detail-columns"><section><h3 class="section-title">Zeitleiste <span class="optional">(${docs.length} Dokumente)</span></h3><div class="timeline">${docs.length ? docs.map(d => `<article class="timeline-item"><div class="timeline-date">${formatDate(d.date)}${d.deadline ? ` · Frist: <span class="${deadlineClass(d.deadline)}">${formatDate(d.deadline)}</span>` : ""}</div><div class="timeline-title">${esc(d.title)} <span class="optional">· ${esc(d.type)}</span></div>${d.summary ? `<div class="timeline-desc">${esc(d.summary)}</div>` : ""}</article>`).join("") : empty("Noch keine Dokumente", "Erfassen und ordnen Sie Dokumente diesem Fall zu.")}</div><div class="quick-actions"><button class="button primary" data-open-document-for="${c.id}">＋ Dokument erfassen</button></div></section><section><h3 class="section-title">Notizen</h3><div class="notes">${notes.length ? [...notes].reverse().map(n => `<article class="note"><time>${formatDate(n.date)}</time>${esc(n.text)}</article>`).join("") : empty("Keine Notizen", "Halten Sie wichtige Gedanken und nächste Schritte fest.")}</div></section></div>`;
}
function renderDocuments() {
  const filterSelect = document.getElementById("documentCaseFilter"); const selected = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Alle Fälle</option><option value="unassigned">Nicht zugeordnet</option>${state.cases.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("")}`;
  filterSelect.value = selected && [...filterSelect.options].some(o => o.value === selected) ? selected : "";
  const query = document.getElementById("documentSearch").value.toLowerCase();
  const docs = [...state.documents].filter(d => (!filterSelect.value || (filterSelect.value === "unassigned" ? !d.caseId : d.caseId === filterSelect.value)) && `${d.title} ${d.type} ${d.summary}`.toLowerCase().includes(query)).sort((a,b) => dateValue(b.date) - dateValue(a.date));
  document.getElementById("documentTable").innerHTML = docs.length ? docs.map(d => { const c = getCase(d.caseId); return `<tr><td><span class="doc-title">${esc(d.title)}</span><span class="doc-type">${esc(d.type)}</span></td><td class="small-date">${formatDate(d.date)}</td><td>${c ? esc(c.title) : "<span class='optional'>Nicht zugeordnet</span>"}</td><td class="small-date deadline-cell ${d.deadline ? deadlineClass(d.deadline) : ""}">${d.deadline ? formatDate(d.deadline) : "–"}</td><td><span class="status ${d.status}">${statusLabel(d.status)}</span></td><td>${c ? `<button class="table-action" data-case-id="${c.id}">Öffnen</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="6">${empty("Keine Dokumente gefunden")}</td></tr>`;
}
function addUploads(files) {
  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  const validFiles = [...files].filter(file => allowed.includes(file.type));
  const skipped = files.length - validFiles.length;
  validFiles.forEach(file => state.uploads.unshift({ id: uid(), name: file.name, type: file.type, size: file.size, kind: file.type === "application/pdf" ? "pdf" : "image", status: "queued", addedAt: new Date().toISOString() }));
  saveState(); renderUploadQueue();
  if (validFiles.length) showToast(`${validFiles.length} Datei${validFiles.length === 1 ? "" : "en"} zur Analyse vorgemerkt.`);
  if (skipped) showToast(`${skipped} Datei${skipped === 1 ? " wurde" : "en wurden"} übersprungen (nur PDF, JPG, PNG, WEBP).`);
}
function titleFromFilename(name) { return name.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim() || "Unbenanntes Dokument"; }
function simulationKey(upload) { return titleFromFilename(upload.name).split(" ").slice(0, 2).join(" ").toLowerCase(); }
function dateInDays(days) { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); }
function stableHash(value) { return [...value].reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0) | 0, 0); }
const simulationProfiles = [
  { documentType: "Behördliches Schreiben", priority: "high", deadlineDays: 7, party: "Städtische Verwaltung", summary: "Fristgebundene Stellungnahme angefordert. Unterlagen und nächsten Schritt zeitnah prüfen.", nextStep: "Stellungnahme und benötigte Nachweise vorbereiten." },
  { documentType: "Rechnung", priority: "medium", deadlineDays: 14, party: "Dienstleister (Beispieldaten)", summary: "Zahlungsaufforderung erkannt. Betrag, Leistungszeitraum und mögliche Rückfragen prüfen.", nextStep: "Rechnung fachlich prüfen und Zahlungsfreigabe klären." },
  { documentType: "Versicherungsschreiben", priority: "high", deadlineDays: 5, party: "Versicherung (Beispieldaten)", summary: "Rückmeldung zu einem Versicherungsfall erkannt. Kurze Rückmeldefrist beachten.", nextStep: "Geforderte Angaben und Belege zusammenstellen." },
  { documentType: "Vertrag / Nachtrag", priority: "low", deadlineDays: null, party: "Vertragspartner (Beispieldaten)", summary: "Vertragsbezogene Unterlage erkannt. Kein unmittelbarer Termin aus der Simulation abgeleitet.", nextStep: "Inhalt und Abweichungen zum bestehenden Vertrag vergleichen." },
  { documentType: "Anwaltliches Schreiben", priority: "high", deadlineDays: 10, party: "Kanzlei (Beispieldaten)", summary: "Rechtsbezogene Korrespondenz erkannt. Frist und Forderungen besonders sorgfältig prüfen.", nextStep: "Frist notieren und gegebenenfalls qualifizierte Beratung einholen." },
  { documentType: "Allgemeiner Brief", priority: "low", deadlineDays: null, party: "Absender (Beispieldaten)", summary: "Allgemeine Korrespondenz erkannt. Keine konkrete Frist aus der Simulation abgeleitet.", nextStep: "Inhalt zur Kenntnis nehmen und bei Bedarf nachfassen." }
];
async function simulateAnalysis(upload) {
  await new Promise(resolve => setTimeout(resolve, 650));
  const subject = titleFromFilename(upload.name);
  const autoKey = simulationKey(upload);
  const profile = simulationProfiles[Math.abs(stableHash(upload.name)) % simulationProfiles.length];
  let caseRecord = state.cases.find(c => c.autoKey === autoKey);
  if (!caseRecord) {
    const now = new Date().toISOString();
    caseRecord = { id: uid(), title: subject, reference: `SIM-${Math.abs(stableHash(upload.name)).toString().slice(0, 4).padStart(4, "0")}`, party: profile.party, status: "open", createdAt: now, updatedAt: now, notes: [{ id: uid(), date: now.slice(0, 10), text: "Dieser Fall wurde durch die simulierte Dokumentanalyse angelegt. Angaben bitte prüfen." }], autoKey, generatedByAnalysis: true };
    state.cases.unshift(caseRecord);
  }
  const documentDate = dateInDays(-((Math.abs(stableHash(upload.id)) % 18) + 1));
  const deadline = profile.deadlineDays ? dateInDays(profile.deadlineDays) : "";
  const documentRecord = { id: uid(), title: subject, type: profile.documentType, priority: profile.priority, date: documentDate, caseId: caseRecord.id, deadline, status: "open", summary: profile.summary, nextStep: profile.nextStep, createdAt: new Date().toISOString(), sourceUploadId: upload.id, analysis: { provider: "simulation", confidence: 0.76 + (Math.abs(stableHash(upload.id)) % 20) / 100, analyzedAt: new Date().toISOString() } };
  state.documents.unshift(documentRecord);
  caseRecord.updatedAt = new Date().toISOString();
  return { caseId: caseRecord.id, documentId: documentRecord.id, confidence: documentRecord.analysis.confidence, result: { documentType: profile.documentType, priority: profile.priority, documentDate, deadline, caseTitle: caseRecord.title, summary: profile.summary, nextStep: profile.nextStep } };
}
// Austauschpunkt für Version 2: Dieses Provider-Objekt kann später durch einen OCR-/KI-Adapter ersetzt werden.
const analysisProvider = { name: "simulation", analyze: simulateAnalysis };
async function analyzeUpload(uploadId) {
  const upload = state.uploads.find(item => item.id === uploadId);
  if (!upload || upload.status === "analyzing" || upload.status === "analyzed") return;
  upload.status = "analyzing"; saveState(); renderUploadQueue();
  try {
    const result = await analysisProvider.analyze(upload);
    Object.assign(upload, { status: "analyzed", analyzedAt: new Date().toISOString(), caseId: result.caseId, documentId: result.documentId, analysisProvider: analysisProvider.name, confidence: result.confidence, analysisResult: result.result });
    saveState(); render(); showToast(`„${upload.name}“ wurde analysiert und zugeordnet.`);
  } catch {
    upload.status = "error"; saveState(); renderUploadQueue(); showToast("Die Analyse konnte nicht abgeschlossen werden.");
  }
}
function enqueueAnalysis(uploadId) {
  if (queuedAnalysisIds.has(uploadId)) return analysisQueue;
  const upload = state.uploads.find(item => item.id === uploadId);
  if (!upload || !["queued", "error"].includes(upload.status)) return analysisQueue;
  queuedAnalysisIds.add(uploadId); upload.status = "waiting"; saveState(); renderUploadQueue();
  analysisQueue = analysisQueue.then(() => analyzeUpload(uploadId)).finally(() => queuedAnalysisIds.delete(uploadId));
  return analysisQueue;
}
async function analyzeAllUploads() { for (const upload of state.uploads.filter(item => item.status === "queued" || item.status === "error")) await enqueueAnalysis(upload.id); }
function removeGeneratedAnalysis(upload) {
  if (upload.documentId) state.documents = state.documents.filter(document => document.id !== upload.documentId);
  const caseRecord = getCase(upload.caseId);
  if (caseRecord?.generatedByAnalysis && !state.documents.some(document => document.caseId === caseRecord.id)) {
    state.cases = state.cases.filter(item => item.id !== caseRecord.id);
    if (state.selectedCaseId === caseRecord.id) state.selectedCaseId = null;
  }
}
function resetUploadAnalysis(uploadId) {
  const upload = state.uploads.find(item => item.id === uploadId);
  if (!upload || upload.status !== "analyzed") return;
  removeGeneratedAnalysis(upload);
  Object.assign(upload, { status: "queued", analyzedAt: null, caseId: null, documentId: null, analysisProvider: null, confidence: null, analysisResult: null });
  saveState(); render(); showToast("Analyseergebnis wurde zurückgesetzt.");
}
function deleteUpload(uploadId) {
  const upload = state.uploads.find(item => item.id === uploadId);
  if (!upload || ["waiting", "analyzing"].includes(upload.status)) return;
  if (upload.status === "analyzed") removeGeneratedAnalysis(upload);
  state.uploads = state.uploads.filter(item => item.id !== uploadId);
  saveState(); render(); showToast("Upload und zugehörige Beispieldaten wurden entfernt.");
}
function handleUploadSelection(files) {
  if (!files?.length) return;
  addUploads(files);
  currentView = "documents";
  render();
}
function openModal(type, caseId = "") {
  const template = document.getElementById(`${type}FormTemplate`); document.getElementById("modalContent").innerHTML = template.innerHTML;
  const backdrop = document.getElementById("modalBackdrop"); backdrop.hidden = false;
  if (type === "document") { const select = document.getElementById("documentCaseSelect"); select.innerHTML = `<option value="">Nicht zugeordnet</option>${state.cases.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("")}`; select.value = caseId; document.querySelector("#documentForm [name=date]").value = new Date().toISOString().slice(0,10); }
  if (type === "note") document.getElementById("noteForm").dataset.caseId = caseId;
  document.querySelector(".modal input, .modal textarea, .modal select")?.focus();
}
function closeModal() {
  const backdrop = document.getElementById("modalBackdrop");
  backdrop.hidden = true;
  document.getElementById("modalContent").replaceChildren();
}
function showToast(message) { const t = document.getElementById("toast"); t.textContent = message; t.classList.add("show"); clearTimeout(showToast.timeout); showToast.timeout = setTimeout(() => t.classList.remove("show"), 2600); }
function createCase(form) { const f = new FormData(form); const now = new Date().toISOString(); const c = { id: uid(), title: f.get("title").trim(), reference: f.get("reference").trim(), party: f.get("party").trim(), status: f.get("status"), createdAt: now, updatedAt: now, notes: [] }; if (f.get("note").trim()) c.notes.push({ id:uid(), text:f.get("note").trim(), date:now.slice(0,10) }); state.cases.unshift(c); state.selectedCaseId = c.id; saveState(); closeModal(); currentView = "cases"; render(); showToast("Fall wurde angelegt."); }
function createDocument(form) { const f = new FormData(form); const now = new Date().toISOString(); state.documents.unshift({ id:uid(), title:f.get("title").trim(), type:f.get("type"), date:f.get("date"), caseId:f.get("caseId"), deadline:f.get("deadline"), status:f.get("status"), summary:f.get("summary").trim(), createdAt:now }); const c = getCase(f.get("caseId")); if(c) c.updatedAt = now; saveState(); closeModal(); render(); showToast("Dokument wurde gespeichert."); }
function addNote(form) { const c = getCase(form.dataset.caseId); const text = new FormData(form).get("note").trim(); if (!c || !text) return; const now = new Date().toISOString(); c.notes ||= []; c.notes.push({id:uid(), text, date:now.slice(0,10)}); c.updatedAt=now; saveState(); closeModal(); render(); showToast("Notiz wurde hinzugefügt."); }
function openCase(id) { if (!id || !getCase(id)) return; state.selectedCaseId = id; mobileCaseDetailOpen = isMobileViewport(); saveState(); currentView = "cases"; render(); }

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-view]"); if (nav) { currentView = nav.dataset.view; if (currentView === "cases") mobileCaseDetailOpen = false; render(); return; }
  const shortcut = event.target.closest("[data-view-target]"); if (shortcut) { currentView = shortcut.dataset.viewTarget; render(); return; }
  const dashboardUpload = event.target.closest("[data-dashboard-upload]"); if (dashboardUpload) { document.getElementById(dashboardUpload.dataset.dashboardUpload === "camera" ? "cameraUpload" : "fileUpload").click(); return; }
  const analyze = event.target.closest("[data-analyze-upload]"); if (analyze) { enqueueAnalysis(analyze.dataset.analyzeUpload); return; }
  if (event.target.id === "analyzeAll") { analyzeAllUploads(); return; }
  const resetUpload = event.target.closest("[data-reset-upload]"); if (resetUpload) { resetUploadAnalysis(resetUpload.dataset.resetUpload); return; }
  const deleteUploadButton = event.target.closest("[data-delete-upload]"); if (deleteUploadButton) { deleteUpload(deleteUploadButton.dataset.deleteUpload); return; }
  if (event.target.closest("[data-toggle-completed]")) { completedCasesExpanded = !completedCasesExpanded; renderCases(); return; }
  if (event.target.closest("[data-close-case-detail]")) { mobileCaseDetailOpen = false; renderCases(); return; }
  const newModal = event.target.closest("[data-open-modal]"); if (newModal) { openModal(newModal.dataset.openModal); return; }
  const documentFor = event.target.closest("[data-open-document-for]"); if (documentFor) { openModal("document", documentFor.dataset.openDocumentFor); return; }
  const note = event.target.closest("[data-add-note]"); if (note) { openModal("note", note.dataset.addNote); return; }
  const open = event.target.closest("[data-case-id]"); if (open && !event.target.closest("[data-cycle-status]")) { openCase(open.dataset.caseId); return; }
  const cycle = event.target.closest("[data-cycle-status]"); if (cycle) { const c = getCase(cycle.dataset.cycleStatus); c.status = {open:"progress",progress:"done",done:"open"}[c.status]; c.updatedAt=new Date().toISOString(); saveState(); render(); showToast(`Status: ${statusLabel(c.status)}`); return; }
  if (event.target.id === "closeModal" || event.target.id === "modalBackdrop") closeModal();
  if (event.target.id === "resetData") { if (confirm("Alle lokal gespeicherten Fälle und Dokumente löschen?")) { state = {...defaultState}; saveState(); render(); showToast("Lokale Daten wurden gelöscht."); } }
});
document.addEventListener("submit", event => { if (event.target.id === "caseForm") { event.preventDefault(); createCase(event.target); } if (event.target.id === "documentForm") { event.preventDefault(); createDocument(event.target); } if (event.target.id === "noteForm") { event.preventDefault(); addNote(event.target); } });
document.getElementById("caseSearch").addEventListener("input", renderCases);
document.getElementById("documentSearch").addEventListener("input", renderDocuments);
document.getElementById("documentCaseFilter").addEventListener("change", renderDocuments);
document.getElementById("fileUpload").addEventListener("change", event => { handleUploadSelection(event.target.files); event.target.value = ""; });
document.getElementById("cameraUpload").addEventListener("change", event => { handleUploadSelection(event.target.files); event.target.value = ""; });
const uploadDropzone = document.getElementById("uploadDropzone");
["dragenter", "dragover"].forEach(type => uploadDropzone.addEventListener(type, event => { event.preventDefault(); uploadDropzone.classList.add("dragging"); }));
["dragleave", "drop"].forEach(type => uploadDropzone.addEventListener(type, event => { event.preventDefault(); uploadDropzone.classList.remove("dragging"); }));
uploadDropzone.addEventListener("drop", event => addUploads(event.dataTransfer.files));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
window.addEventListener("resize", () => { if (!isMobileViewport()) mobileCaseDetailOpen = false; renderCases(); });
saveState();
closeModal();
document.querySelector(".main-content").insertAdjacentHTML("beforeend", `<footer class="legal-notice"><strong>Hinweis:</strong> Aktenpilot ist ausschließlich eine Organisationshilfe und bietet keine Rechtsberatung. Prüfen Sie Fristen und rechtliche Schritte stets eigenständig oder mit qualifizierter Beratung.</footer>`);
render();
