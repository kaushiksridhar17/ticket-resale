import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Command } from "./commands.js";

export interface LogEntry {
  seq: number;
  command: Command;
}

export class FileEventLog {
  private readonly path: string;
  private readonly fd: number;
  private seq = 0;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      this.seq = this.readAll().length;
    }
    this.fd = openSync(path, "a");
  }

  append(command: Command): LogEntry {
    this.seq += 1;
    const entry: LogEntry = { seq: this.seq, command };
    writeSync(this.fd, `${JSON.stringify(entry)}\n`);
    return entry;
  }

  flush(): void {
    fsyncSync(this.fd);
  }

  close(): void {
    fsyncSync(this.fd);
    closeSync(this.fd);
  }

  readAll(): LogEntry[] {
    if (!existsSync(this.path)) {
      return [];
    }
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogEntry);
  }

  size(): number {
    return this.seq;
  }
}