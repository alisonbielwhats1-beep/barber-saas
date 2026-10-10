"use client";

import { useEffect } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  useEffect(() => {
    let collapsed: HTMLDetailsElement[] = [];
    const expand = () => { collapsed = Array.from(document.querySelectorAll<HTMLDetailsElement>(".admin-summary-page details:not([open])")); collapsed.forEach(item => { item.open = true; }); };
    const restore = () => { collapsed.forEach(item => { item.open = false; }); collapsed = []; };
    window.addEventListener("beforeprint", expand);
    window.addEventListener("afterprint", restore);
    return () => { window.removeEventListener("beforeprint", expand); window.removeEventListener("afterprint", restore); restore(); };
  }, []);

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
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={downloadCsv} className="max-sm:flex-1">
        <Download aria-hidden="true" className="h-4 w-4 shrink-0" /> CSV / Excel
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => window.print()} className="max-sm:flex-1">
        <Printer aria-hidden="true" className="h-4 w-4 shrink-0" /> Imprimir / PDF
      </Button>
    </div>
  );
}
