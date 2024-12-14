import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button"
import { Column } from "@tanstack/react-table"

export const SortButton = ({ column }: { column: Column<any, unknown> }) => (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      className="p-0 hover:bg-transparent"
    >
      <ArrowUpDown className="h-4 w-4" />
    </Button>
);