import Link from "next/link";
import { PROJECT } from "../config/project";

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 12, letterSpacing: "-0.02em" }}>{PROJECT.name}</h1>
        <p style={{ fontSize: 16, color: "#aaa", marginBottom: 24 }}>{PROJECT.tagline}</p>
        <Link
          href="/crm"
          style={{
            display: "inline-block",
            padding: "12px 24px",
            background: "white",
            color: "#0a0a0a",
            borderRadius: 8,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Abrir CRM →
        </Link>
      </div>
    </main>
  );
}
