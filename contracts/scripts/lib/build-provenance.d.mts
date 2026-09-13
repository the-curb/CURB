export function buildCurrentContracts(): void;
export function currentSourceCommit(source?: string): string;
export function assertRecordedSourceCommit(record: { workingTreeClean?: boolean; sourceCommit?: unknown }, current: string): void;
