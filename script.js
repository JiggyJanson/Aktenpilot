const STORAGE_KEY = "aktenpilot-data-v1";
const defaultState = { cases: [], documents: [], selectedCaseId: null };
let state = loadState();
let currentView = "dashboard";

function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; }
  catch { return { ...defaultState }; }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
function esc(value = "") { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }
function dateValue(value) { return value ? new Date(`${value}T12:00:00`) : null; }
function formatDate(value) { if (!value) return "–"; return dateValue(value).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }); }
function formatShortDate(value) { if (!value) return "–"; return dateValue(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); }
function statusLabel(status) { return { open: "Offen", progress: "In Arbeit", done: "Erledigt" }[status] || "Offen"; }
function getCase(id) { return state.cases.find(c => c.id === id); }
function documentsFor(caseId) { return state.documents.filter(d => d.caseId === caseId); }
function daysUntil(date) { return Math.ceil((dateValue(date) - new Date(new Date().toDateString())) / 86400000); }
function deadlineText(date) { const days = daysUntil(date); if (days < 0) return `${Math.abs(days)} T. überfällig`; if (days === 0) return "Heute fällig"; if (days === 1) return "Morgen fällig"; return `in ${days} Tagen`; }
function deadlineClass(date) { return daysUntil(date) < 0 ? "overdue" : ""; }
function deadlineActive(doc) { return doc.deadline && doc.status !== "done"; }
function empty(text, detail = "") { return `<div class="empty"><strong>${esc(text)}</strong>${esc(detail)}</div>`; }

function render() {
  renderNavigation(); renderDashboard(); renderCases(); renderDocuments();
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `${currentView}-view`));
}
function renderNavigation() { document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.view === currentView)); }
function renderDashboard() {
  const activeDeadlines = state.documents.filter(deadlineActive).sort((a,b) => dateValue(a.deadline) - dateValue(b.deadline));
  const openCases = state.cases.filter(c => c.status !== "done").length;
  const dueSoon = activeDeadlines.filter(d => daysUntil(d.deadline) <= 7).length;
  document.getElementById("statCards").innerHTML = [
    [state.cases.length, "Fälle insgesamt", "◫", ""], [openCases, "Aktive Fälle", "◌", ""],
    [dueSoon, "Fristen in 7 Tagen", "◷", dueSoon ? "warn" : ""], [activeDeadlines.filter(d => daysUntil(d.deadline) < 0).length, "Überfällige Fristen", "!", activeDeadlines.some(d => daysUntil(d.deadline) < 0) ? "danger" : ""]
  ].map(([number, label, icon, className]) => `<article class="stat-card ${className}"><div class="stat-label"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${number}</div><div class="stat-sub">${number === 1 ? "Eintrag" : "Einträge"}</div></article>`).join("");
  document.getElementById("deadlineList").innerHTML = activeDeadlines.length ? activeDeadlines.slice(0,6).map(d => {
    const c = getCase(d.caseId); const date = dateValue(d.deadline);
    return `<article class="deadline-item" data-case-id="${d.caseId || ""}"><div class="deadline-date"><strong>${date.getDate()}</strong>${date.toLocaleDateString("de-DE", { month:"short" })}</div><div class="deadline-copy"><b>${esc(d.title)}</b><span>${c ? esc(c.title) : "Nicht zugeordnet"}</span></div><span class="urgency ${deadlineClass(d.deadline)}">${deadlineText(d.deadline)}</span></article>`;
  }).join("") : empty("Keine offenen Fristen", "Fristen aus Dokumenten erscheinen hier automatisch.");
  const cases = [...state.cases].sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  document.getElementById("recentCases").innerHTML = cases.length ? cases.slice(0,6).map(c => `<article class="recent-case" data-case-id="${c.id}"><div class="case-initial">${esc(c.title.charAt(0).toUpperCase())}</div><div style="min-width:0"><span class="case-name">${esc(c.title)}</span><small>${c.reference ? esc(c.reference) : c.party ? esc(c.party) : "Ohne Aktenzeichen"}</small></div><span class="status ${c.status}">${statusLabel(c.status)}</span></article>`).join("") : empty("Noch keine Fälle", "Legen Sie Ihren ersten Fall an, um zu starten.");
}
function renderCases() {
  const query = document.getElementById("caseSearch").value.toLowerCase();
  const filtered = state.cases.filter(c => `${c.title} ${c.reference} ${c.party}`.toLowerCase().includes(query));
  if (!state.selectedCaseId && state.cases[0]) state.selectedCaseId = state.cases[0].id;
  if (!getCase(state.selectedCaseId)) state.selectedCaseId = state.cases[0]?.id || null;
  document.getElementById("caseList").innerHTML = filtered.length ? filtered.map(c => `<article class="case-row ${c.id === state.selectedCaseId ? "selected" : ""}" data-case-id="${c.id}"><div class="case-row-top"><span class="case-name">${esc(c.title)}</span><span class="status ${c.status}">${statusLabel(c.status)}</span></div><small>${esc(c.reference || c.party || "Keine zusätzlichen Angaben")}</small></article>`).join("") : empty("Keine passenden Fälle");
  const c = getCase(state.selectedCaseId); const detail = document.getElementById("caseDetail");
  if (!c) { detail.innerHTML = empty("Noch kein Fall ausgewählt", "Legen Sie einen Fall an, um eine Zeitleiste aufzubauen."); return; }
  const docs = documentsFor(c.id).sort((a,b) => dateValue(b.date) - dateValue(a.date));
  const notes = c.notes || [];
  detail.innerHTML = `<header class="case-detail-head"><div><h2 class="case-title">${esc(c.title)}</h2><div class="case-meta">${c.reference ? `Aktenzeichen: ${esc(c.reference)} · ` : ""}${c.party ? esc(c.party) : "Keine Beteiligten hinterlegt"}<br>Erstellt am ${formatDate(c.createdAt.slice(0,10))}</div></div><div class="case-detail-actions"><button class="status ${c.status}" data-cycle-status="${c.id}" title="Status ändern">${statusLabel(c.status)}</button><button class="icon-button" data-add-note="${c.id}">＋ Notiz</button></div></header><div class="detail-columns"><section><h3 class="section-title">Zeitleiste <span class="optional">(${docs.length} Dokumente)</span></h3><div class="timeline">${docs.length ? docs.map(d => `<article class="timeline-item"><div class="timeline-date">${formatDate(d.date)}${d.deadline ? ` · Frist: <span class="${deadlineClass(d.deadline)}">${formatDate(d.deadline)}</span>` : ""}</div><div class="timeline-title">${esc(d.title)} <span class="optional">· ${esc(d.type)}</span></div>${d.summary ? `<div class="timeline-desc">${esc(d.summary)}</div>` : ""}</article>`).join("") : empty("Noch keine Dokumente", "Erfassen und ordnen Sie Dokumente diesem Fall zu.")}</div><div class="quick-actions"><button class="button primary" data-open-document-for="${c.id}">＋ Dokument erfassen</button></div></section><section><h3 class="section-title">Notizen</h3><div class="notes">${notes.length ? [...notes].reverse().map(n => `<article class="note"><time>${formatDate(n.date)}</time>${esc(n.text)}</article>`).join("") : empty("Keine Notizen", "Halten Sie wichtige Gedanken und nächste Schritte fest.")}</div></section></div>`;
}
function renderDocuments() {
  const filterSelect = document.getElementById("documentCaseFilter"); const selected = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Alle Fälle</option><option value="unassigned">Nicht zugeordnet</option>${state.cases.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join("")}`;
  filterSelect.value = selected && [...filterSelect.options].some(o => o.value === selected) ? selected : "";
  const query = document.getElementById("documentSearch").value.toLowerCase();
  const docs = [...state.documents].filter(d => (!filterSelect.value || (filterSelect.value === "unassigned" ? !d.caseId : d.caseId === filterSelect.value)) && `${d.title} ${d.type} ${d.summary}`.toLowerCase().includes(query)).sort((a,b) => dateValue(b.date) - dateValue(a.date));
  document.getElementById("documentTable").innerHTML = docs.length ? docs.map(d => { const c = getCase(d.caseId); return `<tr><td><span class="doc-title">${esc(d.title)}</span><span class="doc-type">${esc(d.type)}</span></td><td class="small-date">${formatDate(d.date)}</td><td>${c ? esc(c.title) : "<span class='optional'>Nicht zugeordnet</span>"}</td><td class="small-date deadline-cell ${d.deadline ? deadlineClass(d.deadline) : ""}">${d.deadline ? formatDate(d.deadline) : "–"}</td><td><span class="status ${d.status}">${statusLabel(d.status)}</span></td><td>${c ? `<button class="table-action" data-case-id="${c.id}">Öffnen</button>` : ""}</td></tr>`; }).join("") : `<tr><td colspan="6">${empty("Keine Dokumente gefunden")}</td></tr>`;
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
function openCase(id) { if (!id || !getCase(id)) return; state.selectedCaseId = id; saveState(); currentView = "cases"; render(); }

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-view]"); if (nav) { currentView = nav.dataset.view; render(); return; }
  const shortcut = event.target.closest("[data-view-target]"); if (shortcut) { currentView = shortcut.dataset.viewTarget; render(); return; }
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
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
closeModal();
document.querySelector(".main-content").insertAdjacentHTML("beforeend", `<footer class="legal-notice"><strong>Hinweis:</strong> Aktenpilot ist ausschließlich eine Organisationshilfe und bietet keine Rechtsberatung. Prüfen Sie Fristen und rechtliche Schritte stets eigenständig oder mit qualifizierter Beratung.</footer>`);
render();
