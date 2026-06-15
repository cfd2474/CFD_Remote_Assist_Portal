import releaseNotesMarkdown from "../../../docs/RELEASE_NOTES.md?raw";

export type ReleaseNote = {
  version: string;
  content: string;
};

const RELEASE_BLOCK =
  /<!-- RELEASE_START version=([\d.]+) -->\s*([\s\S]*?)\s*<!-- RELEASE_END version=\1 -->/g;

function compareSemverDesc(a: string, b: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number(part) || 0);
  const left = parse(a);
  const right = parse(b);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export function parseReleaseNotes(markdown: string): ReleaseNote[] {
  const releases: ReleaseNote[] = [];

  for (const match of markdown.matchAll(RELEASE_BLOCK)) {
    const version = match[1];
    const content = match[2]?.trim() ?? "";
    if (version && content) {
      releases.push({ version, content });
    }
  }

  return releases.sort((a, b) => compareSemverDesc(a.version, b.version));
}

export const releaseNotes = parseReleaseNotes(releaseNotesMarkdown);

export function getReleaseNote(
  version: string | undefined
): ReleaseNote | undefined {
  if (!version) {
    return undefined;
  }

  return releaseNotes.find((note) => note.version === version);
}
