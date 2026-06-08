import type { Metadata } from "next";
import { PROJECT } from "../../config/project";
import "./crm.css";

export const metadata: Metadata = {
  title: `${PROJECT.name} — ${PROJECT.tagline}`,
  description: "Pipeline de qualificação de leads com Assistente IA",
};

export default function CrmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="crm-root">{children}</div>;
}
