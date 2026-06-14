/** Format stored phone digits for display (US +1 when 10/11 digits). */
export function formatPhoneNumber(value: string | null | undefined): string {
  if (!value?.trim()) return "—";

  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 11)}`;
  }

  if (digits.length === 10) {
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  }

  return value.trim();
}
