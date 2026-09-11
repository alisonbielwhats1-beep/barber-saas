"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <section className="hq-panel" role="alert"><h1>Não foi possível carregar o HQ</h1><p>Tente novamente. Se o problema persistir, verifique a conexão e a ativação do banco.</p><button className="hq-button" onClick={reset}>Tentar novamente</button></section>;}

