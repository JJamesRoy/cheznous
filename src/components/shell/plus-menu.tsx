import { ListGroup, Row } from "@/components/ui/list";
import { PLUS_ITEMS } from "./nav";

/** Content of the mobile "Plus" tab (`/plus`): the sections not in the tab bar. */
export function PlusMenu({ className }: { className?: string }) {
  return (
    <nav aria-label="Autres sections" className={className}>
      <ListGroup as="ul">
        {PLUS_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Row href={item.href} leading={<Icon aria-hidden />} title={item.label} />
            </li>
          );
        })}
      </ListGroup>
    </nav>
  );
}
