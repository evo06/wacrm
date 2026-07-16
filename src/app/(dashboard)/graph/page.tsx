"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Network, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Read-only explorer for the Graphify code knowledge graph
 * (`public/graph/graph.json`, regenerated via `graphify extract .` — see
 * AGENTS.md). Node/edge counts here can be in the thousands, so this
 * renders a searchable table + neighbor inspector rather than a force
 * diagram, which stays responsive at that scale.
 */

interface GraphNode {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string;
  source_location?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: "EXTRACTED" | "INFERRED" | string;
  source_file?: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export default function GraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/graph/graph.json");
        if (!res.ok) throw new Error(`Falha: ${res.status}`);
        const json = (await res.json()) as GraphData;
        if (!cancelled) setData(json);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredNodes = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.nodes.slice(0, 200);
    return data.nodes
      .filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          n.source_file?.toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [data, query]);

  const neighbors = useMemo(() => {
    if (!data || !selected) return [];
    return data.edges.filter(
      (e) => e.source === selected.id || e.target === selected.id,
    );
  }, [data, selected]);

  const extractedCount =
    data?.edges.filter((e) => e.confidence === "EXTRACTED").length ?? 0;
  const inferredCount =
    data?.edges.filter((e) => e.confidence === "INFERRED").length ?? 0;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-sm text-muted-foreground">
        <p>
          Nenhum grafo encontrado em <code>public/graph/graph.json</code>.
          Gere um com <code>graphify extract . --code-only --no-cluster</code>{" "}
          e copie o resultado para essa pasta, ou baixe o artifact mais
          recente do CI (job &quot;Generate code knowledge graph&quot;).
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <Network className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">
          Grafo do código
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Mapa gerado localmente pelo Graphify (tree-sitter, sem LLM) a partir
        do código-fonte deste repositório — {data.nodes.length} nós e{" "}
        {data.edges.length} arestas ({extractedCount} explícitas,{" "}
        {inferredCount} inferidas).
      </p>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, id ou arquivo..."
          className="pl-8"
        />
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
        <div className="overflow-y-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nó</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Arquivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredNodes.map((node) => (
                <TableRow
                  key={node.id}
                  onClick={() => setSelected(node)}
                  className={cn(
                    "cursor-pointer",
                    selected?.id === node.id && "bg-muted",
                  )}
                >
                  <TableCell className="max-w-[220px] truncate font-medium text-foreground">
                    {node.label}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{node.file_type ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    {node.source_file ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {filteredNodes.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Nenhum nó encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="overflow-y-auto rounded-lg border border-border p-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Selecione um nó à esquerda para ver suas conexões.
            </p>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-foreground">
                {selected.label}
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">
                {neighbors.length} conexão(ões)
              </p>
              <div className="flex flex-col gap-1.5">
                {neighbors.map((edge, ix) => {
                  const isSource = edge.source === selected.id;
                  const otherId = isSource ? edge.target : edge.source;
                  const other = data.nodes.find((n) => n.id === otherId);
                  return (
                    <div
                      key={ix}
                      className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs"
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          edge.confidence === "EXTRACTED"
                            ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300"
                            : "border-amber-600/40 bg-amber-500/10 text-amber-300",
                        )}
                      >
                        {edge.confidence}
                      </Badge>
                      <span className="text-muted-foreground">
                        {isSource ? "→" : "←"} {edge.relation}
                      </span>
                      <span className="truncate font-medium text-foreground">
                        {other?.label ?? otherId}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
