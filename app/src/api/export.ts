export function myExportUrl(): string {
  return "/api/me/export";
}

export function petExportUrl(petId: string, format: "json" | "csv"): string {
  return `/api/pets/${petId}/export?format=${format}`;
}
