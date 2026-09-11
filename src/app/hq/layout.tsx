import type { Metadata } from "next";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { isHqEnabled } from "@/lib/hq/access";
import { HqNavigation } from "@/components/hq/navigation";
import "./hq.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default:"Everflare HQ", template:"%s · Everflare HQ" }, robots:{index:false,follow:false} };
export default async function Layout({children}:{children:React.ReactNode}) {
 const admin=await getPlatformAdminContext();
 return <div className="hq"><aside className="hq-sidebar"><div className="hq-brand"><span className="hq-mark">E</span><div>Everflare <b>HQ</b><small>Operação da empresa</small></div></div><div className="hq-desktop-nav"><HqNavigation/></div><details className="hq-mobile-nav"><summary>Abrir menu do HQ</summary><HqNavigation/></details><div className="hq-identity"><span className="hq-dot"/>Área privada<small>{admin.name}</small></div></aside><div className="hq-workspace"><header className="hq-topbar"><span>Central de comando</span><span className="hq-private">Acesso administrativo</span></header><main id="main-content" className="hq-main">{isHqEnabled()?children:<section className="hq-panel"><p className="hq-eyebrow">EVERFLARE HQ</p><h1>Central em preparação</h1><p>A ativação estará disponível após a validação do banco de dados.</p></section>}</main></div></div>;
}

