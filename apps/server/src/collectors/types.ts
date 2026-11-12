export interface RunResult {
  /** Sumber yang menghasilkan data, misalnya "BMKG" */
  source: string;
  count: number;
  /** Peringatan non-fatal, misalnya sumber cadangan dipakai */
  note?: string;
}
