// <pt-app-shell> — top-level orchestrator. Owns the PlanDocumentStore
// instance and the persistence repository, boots the initial project
// (last-opened, or the built-in demo), mounts every other component and
// hands each of them the store, and wires the app-wide message bus for
// cross-feature concerns: imports, saves, and workflow navigation (per the
// architecture brief — everything else stays on the store's own event
// channel). No other component talks to the repository directly except the
// dialogs that need to (import/sheet delete), by design.
import { PtElement, bus, toast, confirmDialog } from '../core.js';
import { PlanDocumentStore } from '../plan/plan-document-store.js';
import { projectRepository } from '../plan/indexeddb-project-repository.js';
import { createDemoProject } from '../plan/demo-project.js';

import './pt-project-header.js';
import './pt-sheet-sidebar.js';
import './pt-workspace-toolbar.js';
import './pt-plan-workspace.js';
import './pt-prepare-panel.js';
import './pt-review-panel.js';
import './pt-status-bar.js';
import './pt-import-dialog.js';
import './pt-calibration-dialog.js';
import './pt-export-dialog.js';

const AUTOSAVE_DEBOUNCE_MS = 800;

export class PtAppShell extends PtElement {
  connect() {
    this.setLoading('Loading PlanTrace…');
    this._boot();
  }

  async _boot() {
    let doc;
    try {
      const lastId = projectRepository.getLastProjectId();
      doc = lastId ? await projectRepository.load(lastId) : null;
    } catch { doc = null; }
    if (!doc) {
      try { doc = await createDemoProject(); } catch (err) { this.showError(err); return; }
    }

    this.store = new PlanDocumentStore(doc);
    window.PlanTraceStore = this.store; // manual QA / debugging hook, read-only in practice

    this._buildShell();
    this._wireAutosave();
    this._wireGlobalKeys();
    this._wireBusHandlers();
    window.addEventListener('beforeunload', (e) => {
      if (this.store.dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    try { await projectRepository.save(this.store.exportDocument()); projectRepository.setLastProjectId(this.store.document.project.id); } catch { /* non-fatal on first boot */ }
  }

  _buildShell() {
    this.innerHTML = `
      <pt-project-header class="pt-shell-top"></pt-project-header>
      <pt-sheet-sidebar class="pt-shell-left"></pt-sheet-sidebar>
      <div class="pt-shell-main">
        <div data-main-prepare></div>
        <div data-main-canvas style="display:flex; flex-direction:column; flex:1; min-height:0;">
          <pt-workspace-toolbar class="pt-workspace-header"></pt-workspace-toolbar>
          <pt-plan-workspace></pt-plan-workspace>
        </div>
      </div>
      <pt-review-panel class="pt-shell-right"></pt-review-panel>
      <pt-status-bar class="pt-shell-status"></pt-status-bar>
      <pt-import-dialog></pt-import-dialog>
      <pt-calibration-dialog></pt-calibration-dialog>
      <pt-export-dialog></pt-export-dialog>
    `;
    // Prepare panel is created lazily/kept mounted so its own bake/preview
    // state doesn't get torn down every time the user leaves the Prepare
    // step — it's just hidden.
    const preparePanel = document.createElement('pt-prepare-panel');
    this.querySelector('[data-main-prepare]').appendChild(preparePanel);

    for (const el of this.querySelectorAll('pt-project-header, pt-sheet-sidebar, pt-workspace-toolbar, pt-plan-workspace, pt-prepare-panel, pt-review-panel, pt-status-bar, pt-import-dialog, pt-calibration-dialog, pt-export-dialog')) {
      el.store = this.store;
    }

    this._syncWorkflowView();
    this.store.addEventListener('workflowstep', () => this._syncWorkflowView(), { signal: this.abort.signal });
  }

  _syncWorkflowView() {
    const isPrepare = this.store.workflowStep === 'prepare';
    this.querySelector('[data-main-prepare]').hidden = !isPrepare;
    this.querySelector('[data-main-canvas]').hidden = isPrepare;
  }

  _wireAutosave() {
    let timer = null;
    this.store.addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this._save(), AUTOSAVE_DEBOUNCE_MS);
    }, { signal: this.abort.signal });
  }

  async _save() {
    this.store.setSaveState('saving');
    try {
      await projectRepository.save(this.store.exportDocument());
      projectRepository.setLastProjectId(this.store.document.project.id);
      this.store.markClean();
      this.store.setSaveState('saved');
    } catch (err) {
      this.store.setSaveState('error');
      toast(`Autosave failed: ${err.message}`, 'error');
    }
  }

  _wireGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.store.undo(); }
      else if (e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); this.store.redo(); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); this.store.redo(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); this._save(); }
    }, { signal: this.abort.signal });
  }

  _wireBusHandlers() {
    bus.subscribe('sheets.imported', () => toast('Sheet imported.', 'success'), this.abort.signal);

    bus.subscribe('demo.load.request', async () => {
      if (this.store.dirty) {
        const ok = await confirmDialog({ title: 'Load demo project?', message: 'This replaces the current project in this view. Your existing project stays saved and can be reopened later from a portable JSON backup.', confirmLabel: 'Load demo', danger: false });
        if (!ok) return;
      }
      const doc = await createDemoProject();
      this.store.loadDocument(doc);
      await this._save();
      toast('Demo project loaded.', 'success');
    }, this.abort.signal);

    bus.subscribe('data.clearAll.request', async () => {
      await projectRepository.clearAll();
      const doc = await createDemoProject();
      this.store.loadDocument(doc);
      toast('All local projects cleared.', 'success');
    }, this.abort.signal);
  }
}
customElements.define('pt-app-shell', PtAppShell);
