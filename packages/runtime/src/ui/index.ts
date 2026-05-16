// `@ampless/runtime/ui` — shadcn-style primitives shared by the admin
// UI (`@ampless/admin`) and theme-side `site-chrome` components in
// templates. These are exposed as a single source of truth so a project
// has one canonical Button / Dialog / Sheet implementation rather than
// duplicating them per consumer.
//
// All primitives use the project-side Tailwind theme (the `bg-primary`,
// `text-card-foreground`, etc. CSS variables come from each template's
// `globals.css` + theme tokens). The primitives ship class strings only,
// not stylesheet bundles.

export { cn } from './cn.js'
export { Button, buttonVariants, type ButtonProps } from './button.js'
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from './card.js'
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './dialog.js'
export { Input } from './input.js'
export { Label } from './label.js'
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from './sheet.js'
export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from './table.js'
export { Textarea } from './textarea.js'
