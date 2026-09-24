import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ListingError } from "./types.js";

export const MAX_BYTES = 5 * 1024 * 1024;

interface Kind {
  extension: string;
  contentType: string;
  matches: (bytes: Buffer) => boolean;
}

// What the file claims to be is worth nothing, so the first bytes decide.
const KINDS: Kind[] = [
  {
    extension: "jpg",
    contentType: "image/jpeg",
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    extension: "png",
    contentType: "image/png",
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    extension: "webp",
    contentType: "image/webp",
    matches: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

export function identify(bytes: Buffer): Kind {
  const kind = KINDS.find((candidate) => candidate.matches(bytes));
  if (!kind) {
    throw new ListingError("That file is not a JPEG, a PNG or a WebP");
  }
  return kind;
}

export function contentTypeFor(name: string): string {
  const extension = name.split(".").pop() ?? "";
  return (
    KINDS.find((kind) => kind.extension === extension)?.contentType ??
    "application/octet-stream"
  );
}

export class EvidenceStore {
  private readonly directory: string;

  private ready = false;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  // The name is ours, never theirs, so an upload cannot choose where it
  // lands or what it is called.
  save(bytes: Buffer): string {
    if (bytes.length === 0) {
      throw new ListingError("That file is empty");
    }
    if (bytes.length > MAX_BYTES) {
      throw new ListingError("Photos have to be under 5MB");
    }

    const kind = identify(bytes);
    if (!this.ready) {
      mkdirSync(this.directory, { recursive: true });
      this.ready = true;
    }
    const name = `${randomBytes(16).toString("hex")}.${kind.extension}`;
    writeFileSync(join(this.directory, name), bytes);
    return name;
  }

  read(name: string): Buffer {
    if (!/^[0-9a-f]{32}\.(jpg|png|webp)$/.test(name)) {
      throw new ListingError(`Unknown evidence ${name}`);
    }
    return readFileSync(join(this.directory, name));
  }
}
