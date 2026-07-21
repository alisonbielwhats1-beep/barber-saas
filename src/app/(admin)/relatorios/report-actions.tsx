"use client";

import { Download, Printer } from "lucide-react";

export type ReportSection = { title: string; headers: string[]; rows: (string | number)[][] };

function toCsv(sections: ReportSection[]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  for (const sec of sections) {
    lines.push(sec.title);
    lines.push(sec.headers.map(esc).join(";"));
    for (const r of sec.rows) lines.push(r.map(esc).join(";"));
    lines.push("");
  }
  return lines.join("\n");
}

export function ReportActions({ sections, filename }: { sections: ReportSection[]; filename: string }) {
  function downloadCsv() {
    // BOM para Excel abrir acentos corretamente
    const blob = new Blob(["﻿" + toCsv(sections)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <button onClick={downloadCsv} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-[12px] font-medium text-muted-foreground transition hover:text-foreground">
        <Download className="h-3.5 w-3.5" /> CSV / Excel
      </button>
      <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-[12px] font-medium text-muted-foreground transition hover:text-foreground">
        <Printer className="h-3.5 w-3.5" /> Imprimir / PDF
      </button>
    </div>
  );
}
