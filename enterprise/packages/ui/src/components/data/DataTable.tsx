"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type Row,
  type Table as TanstackTable,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Download,
  LayoutList,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { EmptyState } from "../layout/EmptyState";
import { useLocale } from "../../branding/locale";

const DATA_TABLE_COPY = {
  zh: {
    searchPlaceholder: "搜索...",
    export: "导出",
    filtered: "已筛选：",
    clear: "清空",
    removeFilter: (label: string) => `移除 ${label}`,
    emptyTitle: "暂无数据",
    emptyDescription: "调整筛选条件或稍后再试",
    pagination: (total: number, page: number, pages: number) =>
      `共 ${total} 条 · 第 ${page} / ${pages} 页`,
    prevPage: "上一页",
    nextPage: "下一页",
    columns: "列",
    showColumns: "显示列",
    density: "密度",
    densityAria: "切换密度",
    compact: "紧凑",
    standard: "标准",
    comfortable: "宽松",
  },
  en: {
    searchPlaceholder: "Search...",
    export: "Export",
    filtered: "Filtered:",
    clear: "Clear",
    removeFilter: (label: string) => `Remove ${label}`,
    emptyTitle: "No data",
    emptyDescription: "Adjust filters or try again later",
    pagination: (total: number, page: number, pages: number) =>
      `${total} items · Page ${page} / ${pages}`,
    prevPage: "Previous page",
    nextPage: "Next page",
    columns: "Columns",
    showColumns: "Toggle columns",
    density: "Density",
    densityAria: "Change density",
    compact: "Compact",
    standard: "Default",
    comfortable: "Comfortable",
  },
};

type DataTableCopy = {
  searchPlaceholder: string;
  export: string;
  filtered: string;
  clear: string;
  removeFilter: (label: string) => string;
  emptyTitle: string;
  emptyDescription: string;
  pagination: (total: number, page: number, pages: number) => string;
  prevPage: string;
  nextPage: string;
  columns: string;
  showColumns: string;
  density: string;
  densityAria: string;
  compact: string;
  standard: string;
  comfortable: string;
};

/**
 * DataTable · IAM/审计/计量等表格页面的统一工具
 *
 * 功能：
 *   - 列定义驱动（@tanstack/react-table v8）
 *   - 工具条：搜索（全局）+ 筛选 chip 区域 + 列显隐 + 密度切换 + 导出 + 分页
 *   - 支持排序、选择、空态
 *   - 密度：compact / default / comfortable（切换 cell padding）
 *   - SSR 友好（可脱水）
 */

type Density = "compact" | "default" | "comfortable";

export interface DataTableToolbarFilter {
  /** 唯一 id，用于 columnFilters 里 accessor */
  id: string;
  /** 标签（chip 里显示） */
  label: string;
  /** 已激活 */
  active?: boolean;
  onRemove?: () => void;
  render?: React.ReactNode;
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** 是否显示全局搜索框 */
  enableGlobalFilter?: boolean;
  /** 全局搜索 placeholder */
  searchPlaceholder?: string;
  /** 工具条左侧自定义内容（搜索框旁） */
  toolbarLeft?: React.ReactNode;
  /** 工具条右侧自定义内容（列显隐左边） */
  toolbarRight?: React.ReactNode;
  /** 激活的筛选 chip 列表 */
  activeFilters?: DataTableToolbarFilter[];
  /** 清空所有筛选回调 */
  onClearFilters?: () => void;
  /** 点击行回调（支持详情抽屉） */
  onRowClick?: (row: Row<TData>) => void;
  /** 导出按钮回调；未传则不显示 */
  onExport?: () => void | Promise<void>;
  /** 控制是否显示分页 */
  enablePagination?: boolean;
  /** 每页行数 */
  pageSize?: number;
  /** 空态 */
  emptyState?: React.ReactNode;
  /** 行唯一 id 提取 */
  getRowId?: (row: TData) => string;
  /** 外层 className */
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  enableGlobalFilter = true,
  searchPlaceholder,
  toolbarLeft,
  toolbarRight,
  activeFilters,
  onClearFilters,
  onRowClick,
  onExport,
  enablePagination = true,
  pageSize = 20,
  emptyState,
  getRowId,
  className,
}: DataTableProps<TData, TValue>) {
  const { locale } = useLocale();
  const copy: DataTableCopy = locale === "en" ? DATA_TABLE_COPY.en : DATA_TABLE_COPY.zh;
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [density, setDensity] = React.useState<Density>("default");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    initialState: {
      pagination: { pageSize },
    },
  });

  const densityCellClass =
    density === "compact" ? "py-1.5" : density === "comfortable" ? "py-3.5" : "py-2.5";
  const hasFilters = (activeFilters?.length ?? 0) > 0 || columnFilters.length > 0 || globalFilter.length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* ===== 工具条 ===== */}
      <div className="flex flex-wrap items-center gap-2">
        {enableGlobalFilter ? (
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder ?? copy.searchPlaceholder}
              className="pl-8"
            />
          </div>
        ) : null}

        {toolbarLeft}

        <div className="ml-auto flex items-center gap-2">
          {toolbarRight}

          <DensitySwitcher density={density} onChange={setDensity} copy={copy} />
          <ColumnVisibilityMenu table={table} copy={copy} />

          {onExport ? (
            <Button variant="outline" size="sm" onClick={() => void onExport()} className="gap-1.5">
              <Download />
              {copy.export}
            </Button>
          ) : null}
        </div>
      </div>

      {/* ===== 激活的筛选 chip 行 ===== */}
      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="mr-1 text-xs text-muted-foreground">{copy.filtered}</span>
          {activeFilters?.map((filter) => (
            <Badge key={filter.id} variant="soft" className="gap-1 pl-2 pr-1">
              <span>
                {filter.label}
                {filter.render ? <>：{filter.render}</> : null}
              </span>
              {filter.onRemove ? (
                <button
                  type="button"
                  onClick={filter.onRemove}
                  className="rounded-full p-0.5 hover:bg-background/60"
                  aria-label={copy.removeFilter(filter.label)}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setGlobalFilter("");
              setColumnFilters([]);
              onClearFilters?.();
            }}
            className="ml-1 gap-1"
          >
            <X />
            {copy.clear}
          </Button>
        </div>
      ) : null}

      {/* ===== 表格 ===== */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ChevronsUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={densityCellClass}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 p-6">
                  {emptyState ?? (
                    <EmptyState
                      icon={<LayoutList className="h-5 w-5" />}
                      title={copy.emptyTitle}
                      description={copy.emptyDescription}
                      size="sm"
                      className="border-0"
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ===== 分页 ===== */}
      {enablePagination ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {copy.pagination(
              table.getFilteredRowModel().rows.length,
              table.getState().pagination.pageIndex + 1,
              Math.max(1, table.getPageCount()),
            )}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label={copy.prevPage}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label={copy.nextPage}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
 * 辅助：列显隐下拉
 * ============================================================ */
function ColumnVisibilityMenu<TData>({
  table,
  copy,
}: {
  table: TanstackTable<TData>;
  copy: DataTableCopy;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 />
          {copy.columns}
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{copy.showColumns}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(!!value)}
            >
              {String(column.columnDef.header ?? column.id)}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ============================================================
 * 辅助：密度切换
 * ============================================================ */
function DensitySwitcher({
  density,
  onChange,
  copy,
}: {
  density: Density;
  onChange: (value: Density) => void;
  copy: DataTableCopy;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={copy.densityAria}>
          <Rows3 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{copy.density}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={density === "compact"} onCheckedChange={() => onChange("compact")}>
          {copy.compact}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={density === "default"} onCheckedChange={() => onChange("default")}>
          {copy.standard}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={density === "comfortable"} onCheckedChange={() => onChange("comfortable")}>
          {copy.comfortable}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
