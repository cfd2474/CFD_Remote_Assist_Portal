function parseSemver(value: string): number[] {
  return value.split(".").map((part) => Number(part) || 0);
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export function isNewerVersion(
  latest: string | null | undefined,
  installed: string | null | undefined
): boolean {
  if (!latest?.trim() || !installed?.trim()) {
    return false;
  }

  return compareSemver(latest, installed) > 0;
}
