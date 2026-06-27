import * as vscode from 'vscode';
import { groupByChangelist } from '../engine/changelist/grouper';
import type { ChangelistAssignment, ChangelistDef, GroupedChangelist } from '../engine/changelist/grouper';

const DEFAULT_ID = 'default';
const DEFAULT_NAME = 'Default';

interface PersistedState {
	defs: ChangelistDef[];
	activeId: string;
	assignments: ChangelistAssignment;
}

/**
 * ChangelistRegistry：仿 IDEA ChangeListManager 的多 changelist 管理。
 * 维护命名 changelist 列表 + fileKey→changelist 分配表 + active changelist；
 * 持久化于 workspaceState（按仓库根隔离），重启后恢复。
 */
export class ChangelistRegistry implements vscode.Disposable {
	private defs: ChangelistDef[];
	private activeId: string;
	private assignments: ChangelistAssignment;
	private readonly storageKey: string;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

	constructor(private readonly workspaceState: vscode.Memento, repoRoot: string) {
		this.storageKey = `hyperGit.changelists:${repoRoot}`;
		const loaded = this.load();
		this.defs = loaded.defs;
		this.activeId = loaded.activeId;
		this.assignments = loaded.assignments;
	}

	private load(): PersistedState {
		const fallback: PersistedState = { defs: [{ id: DEFAULT_ID, name: DEFAULT_NAME }], activeId: DEFAULT_ID, assignments: {} };
		const raw = this.workspaceState.get<string>(this.storageKey);
		if (!raw) {
			return fallback;
		}
		try {
			const s = JSON.parse(raw) as PersistedState;
			if (!s.defs?.length) {
				s.defs = fallback.defs;
			}
			if (!s.activeId || !s.defs.some((d) => d.id === s.activeId)) {
				s.activeId = s.defs[0].id;
			}
			s.assignments = s.assignments ?? {};
			return s;
		} catch {
			return fallback;
		}
	}

	private persist(): void {
		const state: PersistedState = { defs: this.defs, activeId: this.activeId, assignments: this.assignments };
		void this.workspaceState.update(this.storageKey, JSON.stringify(state));
		this._onDidChange.fire();
	}

	getGroups<T>(items: readonly T[], keyOf: (item: T) => string): GroupedChangelist<T>[] {
		return groupByChangelist(items, keyOf, this.defs, this.assignments, this.activeId);
	}

	listDefs(): readonly ChangelistDef[] {
		return this.defs;
	}

	get activeChangelistId(): string {
		return this.activeId;
	}

	getDef(id: string): ChangelistDef | undefined {
		return this.defs.find((d) => d.id === id);
	}

	create(name: string): string {
		const id = `cl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
		this.defs = [...this.defs, { id, name }];
		this.persist();
		return id;
	}

	rename(id: string, name: string): void {
		if (id === DEFAULT_ID) {
			return; // 默认列表名固定
		}
		this.defs = this.defs.map((d) => (d.id === id ? { ...d, name } : d));
		this.persist();
	}

	setActive(id: string): void {
		if (!this.defs.some((d) => d.id === id)) {
			return;
		}
		this.activeId = id;
		this.persist();
	}

	/** 删除 changelist；其下文件重新归属到默认列表。 */
	remove(id: string): void {
		if (id === DEFAULT_ID || this.defs.length <= 1) {
			return;
		}
		this.defs = this.defs.filter((d) => d.id !== id);
		const reassigned: ChangelistAssignment = {};
		for (const [key, cid] of Object.entries(this.assignments)) {
			reassigned[key] = cid === id ? DEFAULT_ID : cid;
		}
		this.assignments = reassigned;
		if (this.activeId === id) {
			this.activeId = DEFAULT_ID;
		}
		this.persist();
	}

	move(fileKey: string, targetId: string): void {
		if (!this.defs.some((d) => d.id === targetId)) {
			return;
		}
		this.assignments = { ...this.assignments, [fileKey]: targetId };
		this.persist();
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}
