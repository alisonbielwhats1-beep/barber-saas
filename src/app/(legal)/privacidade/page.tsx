import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalSection, LegalShell, LegalTable } from "../legal-shell";
import {
  OPERATOR_LEGAL_NAME,
  PRIVACY_CONTACT_EMAIL,
  SERVICE_NAME,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: `Política de Privacidade — ${SERVICE_NAME}`,
  description:
    "Quais dados o SalonSaaS trata, para quê, com quem compartilha e como exercer seus direitos sob a LGPD.",
};

/**
 * Descreve a prática real do sistema, não um modelo genérico: os dados listados
 * saem do `schema.prisma`, os subprocessadores das integrações que o código
 * efetivamente chama e os cookies dos nomes que o NextAuth e o `getTenantContext`
 * usam. Política que não bate com o comportamento do software é pior do que
 * nenhuma — vira declaração falsa.
 */
export default function PrivacidadePage() {
  return (
    <LegalShell
      title="Política de Privacidade"
      intro="Esta política explica quais dados pessoais o SalonSaaS trata, por quê, com quem compartilha e como você exerce seus direitos previstos na Lei Geral de Proteção de Dados (Lei 13.709/2018)."
    >
      <LegalSection title="1. Dois papéis diferentes — e por que isso importa para você">
        <p>
          O {SERVICE_NAME} é usado por dois públicos, e a lei nos coloca em posições
          diferentes em cada caso. Entender qual é o seu caso determina a quem você
          deve pedir acesso, correção ou exclusão dos seus dados.
        </p>
        <LegalList
          items={[
            <>
              <strong className="text-foreground">
                Se você é dono ou faz parte da equipe de um estabelecimento
              </strong>{" "}
              e criou uma conta aqui: somos <strong className="text-foreground">controladores</strong>{" "}
              dos dados da sua conta. Nós decidimos como eles são tratados, e você
              trata diretamente conosco.
            </>,
            <>
              <strong className="text-foreground">
                Se você é cliente de um estabelecimento
              </strong>{" "}
              e seus dados foram cadastrados por ele: o estabelecimento é o{" "}
              <strong className="text-foreground">controlador</strong> e nós somos{" "}
              <strong className="text-foreground">operadores</strong> — processamos os
              dados sob instrução dele. Na prática, quem decide o que é coletado,
              por quanto tempo fica e se será apagado é o estabelecimento. Por isso,
              pedidos sobre esses dados devem ir primeiro a ele; nós damos suporte
              técnico para atendê-los.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="2. Quais dados tratamos">
        <p>
          Não coletamos nada além do que a operação do sistema exige. A tabela abaixo
          reflete os campos que existem de fato no banco de dados:
        </p>
        <LegalTable
          headers={["Quem", "Dados", "Origem"]}
          rows={[
            [
              "Dono e equipe",
              "Nome, e-mail, telefone e senha (guardada apenas como hash, nunca em texto)",
              "Você informa ao criar a conta",
            ],
            [
              "Estabelecimento",
              "Nome, endereço, telefone, WhatsApp, Instagram, descrição e imagens da página pública",
              "Você informa nas configurações",
            ],
            [
              "Cliente do estabelecimento",
              "Nome, telefone, e-mail, data de aniversário, gênero e observações livres escritas pelo estabelecimento. Senha (em hash) apenas se o cliente criar acesso próprio",
              "Cadastrado pelo estabelecimento ou pelo próprio cliente ao agendar",
            ],
            [
              "Atendimentos",
              "Data, horário, serviço, profissional, valor, situação e observações",
              "Gerado ao agendar",
            ],
            [
              "Financeiro",
              "Pagamentos, forma de pagamento, pacotes, assinaturas e despesas do estabelecimento",
              "Registrado pelo estabelecimento",
            ],
            [
              "Imagens",
              "Fotos de portfólio e de produtos enviadas pelo estabelecimento",
              "Upload feito por você",
            ],
          ]}
        />
        <p>
          <strong className="text-foreground">Dados sensíveis:</strong> o campo de
          observações é de texto livre e fica sob controle do estabelecimento. Se ele
          registrar ali informação de saúde (alergias, condições de pele, reações a
          produtos), isso é dado sensível na LGPD e exige cuidado redobrado — o
          estabelecimento, como controlador, é responsável por essa decisão e pela
          base legal correspondente.
        </p>
      </LegalSection>

      <LegalSection title="3. Dados coletados automaticamente">
        <LegalList
          items={[
            <>
              <strong className="text-foreground">Endereço IP</strong>, usado para
              conter abuso e tentativas automatizadas. Antes de virar chave de
              controle, o endereço é convertido em hash SHA-256 — não guardamos o IP
              em texto no nosso mecanismo de proteção. Nossa hospedagem, porém,
              mantém registros de acesso próprios (veja a seção 5).
            </>,
            <>
              <strong className="text-foreground">Cookies estritamente necessários</strong>,
              detalhados na seção 6.
            </>,
          ]}
        />
        <p>
          Não usamos Google Analytics, pixel de rede social, mapa de calor ou
          qualquer ferramenta de rastreamento de comportamento. Não construímos
          perfil publicitário e não vendemos dados — nem os seus, nem os dos seus
          clientes.
        </p>
      </LegalSection>

      <LegalSection title="4. Para que usamos e com que base legal">
        <LegalTable
          headers={["Finalidade", "Base legal (LGPD)"]}
          rows={[
            [
              "Criar e manter sua conta, autenticar acessos",
              "Execução de contrato (art. 7º, V)",
            ],
            [
              "Operar a agenda, o cadastro de clientes e o financeiro do estabelecimento",
              "Execução de contrato (art. 7º, V)",
            ],
            [
              "Permitir que o cliente final agende, consulte e cancele atendimentos",
              "Execução de contrato e procedimentos preliminares (art. 7º, V)",
            ],
            [
              "Conter abuso, fraude e uso automatizado indevido",
              "Legítimo interesse (art. 7º, IX)",
            ],
            [
              "Cumprir obrigação legal ou responder a autoridade competente",
              "Obrigação legal (art. 7º, II)",
            ],
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Com quem compartilhamos">
        <p>
          Não vendemos nem cedemos dados pessoais. Compartilhamos apenas com os
          prestadores necessários para o serviço funcionar:
        </p>
        <LegalTable
          headers={["Prestador", "Para quê", "Onde"]}
          rows={[
            [
              "Vercel",
              "Hospedagem, execução da aplicação e registros de acesso",
              "Processamento em São Paulo (região gru1); a empresa é sediada nos EUA",
            ],
            [
              "Supabase",
              "Banco de dados e armazenamento de imagens",
              "São Paulo (sa-east-1)",
            ],
            [
              "Upstash (via integração da Vercel)",
              "Contenção de abuso — recebe apenas o hash do IP, nunca o endereço",
              "Conforme a região configurada na integração",
            ],
            [
              "Resend",
              "Envio de e-mail de convite de equipe. Integração não configurada no momento — enquanto assim estiver, nenhum e-mail é enviado e nenhum dado chega a este prestador",
              "Conforme o prestador",
            ],
            [
              "GoQR (api.qrserver.com)",
              "Gerar a imagem do QR code de divulgação. Recebe apenas o endereço público de agendamento do estabelecimento — nenhum dado pessoal",
              "Conforme o prestador",
            ],
            [
              "Unsplash",
              "Imagens ilustrativas carregadas diretamente pelo navegador de quem visita. Isso expõe o IP do visitante ao Unsplash, como em qualquer imagem externa na web",
              "Conforme o prestador",
            ],
          ]}
        />
        <p>
          Alguns desses prestadores são sediados fora do Brasil, o que caracteriza
          transferência internacional de dados. Nesses casos ela ocorre para permitir
          a execução do contrato com você, nos termos do art. 33 da LGPD.
        </p>
      </LegalSection>

      <LegalSection title="6. Cookies">
        <p>
          Usamos apenas cookies necessários para o funcionamento. Nenhum é de
          publicidade ou análise de audiência — por isso não exibimos banner de
          consentimento, que a lei reserva justamente para os cookies não essenciais.
        </p>
        <LegalTable
          headers={["Cookie", "Para quê"]}
          rows={[
            [
              "next-auth.session-token",
              "Mantém você conectado ao painel. Em HTTPS recebe o prefixo __Secure-",
            ],
            ["next-auth.csrf-token", "Protege formulários contra requisição forjada"],
            ["next-auth.callback-url", "Leva você de volta à página certa após o login"],
            [
              "active_salon",
              "Guarda qual estabelecimento está ativo, para quem administra mais de um",
            ],
          ]}
        />
      </LegalSection>

      <LegalSection title="7. Por quanto tempo guardamos">
        <LegalList
          items={[
            "Dados da conta e do estabelecimento: enquanto a conta existir.",
            "Dados de clientes e atendimentos: enquanto o estabelecimento mantiver a conta ativa, já que é ele quem define esse prazo como controlador.",
            "Excluída a conta, os dados vinculados são apagados, salvo o que precisar ser mantido por obrigação legal ou para defesa em processo.",
            "Registros de contenção de abuso: apagados automaticamente ao fim da janela de contagem, que é de minutos ou horas.",
          ]}
        />
      </LegalSection>

      <LegalSection title="8. Segurança">
        <p>
          Nenhum sistema é imune, e seria desonesto prometer o contrário. O que
          adotamos concretamente:
        </p>
        <LegalList
          items={[
            "Senhas nunca são guardadas em texto — apenas o hash bcrypt, que não permite reverter a senha original.",
            "Todo o tráfego trafega por HTTPS.",
            "Cada estabelecimento tem seus dados isolados: toda consulta ao banco é filtrada pelo identificador do estabelecimento da sessão ativa.",
            "Acesso ao financeiro é restrito por papel — quem não tem permissão não vê o módulo nem acessa a rota.",
            "O banco de dados fica em São Paulo, e não é exposto publicamente à internet.",
            "Limites de tentativa em login, cadastro e agendamento, para conter ataque automatizado.",
          ]}
        />
        <p>
          Se identificarmos incidente de segurança com risco relevante aos titulares,
          comunicaremos os afetados e a ANPD, conforme o art. 48 da LGPD.
        </p>
      </LegalSection>

      <LegalSection title="9. Seus direitos">
        <p>O art. 18 da LGPD garante a você, a qualquer momento e sem custo:</p>
        <LegalList
          items={[
            "Confirmar se tratamos dados seus e acessar esses dados.",
            "Corrigir dados incompletos, inexatos ou desatualizados.",
            "Pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade com a lei.",
            "Solicitar a portabilidade a outro fornecedor.",
            "Ser informado com quem compartilhamos seus dados.",
            "Revogar o consentimento, quando o tratamento se basear nele.",
            "Opor-se a tratamento feito com base em legítimo interesse.",
          ]}
        />
        <p>
          <strong className="text-foreground">Se você é cliente de um estabelecimento:</strong>{" "}
          procure primeiro o próprio estabelecimento, que é o controlador dos seus
          dados. Se ele não responder ou você não souber como contatá-lo, escreva
          para nós que ajudamos a direcionar.
        </p>
        <p>
          Para exercer qualquer direito, escreva para{" "}
          <a
            href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
            className="text-foreground underline underline-offset-4"
          >
            {PRIVACY_CONTACT_EMAIL}
          </a>
          . Respondemos em até 15 dias. Podemos pedir informação adicional para
          confirmar sua identidade antes de liberar ou apagar dados — é proteção
          contra alguém se passar por você.
        </p>
      </LegalSection>

      <LegalSection title="10. Crianças e adolescentes">
        <p>
          O painel administrativo é destinado a maiores de 18 anos. Atendimentos de
          menores podem ser agendados por pais ou responsáveis, e cabe ao
          estabelecimento obter o consentimento específico exigido pelo art. 14 da
          LGPD antes de cadastrar dados de criança.
        </p>
      </LegalSection>

      <LegalSection title="11. Alterações nesta política">
        <p>
          Podemos atualizar este documento. A data de última atualização no topo
          sempre reflete a versão vigente. Mudança que altere de forma relevante como
          tratamos seus dados será avisada pelos canais de contato antes de entrar em
          vigor.
        </p>
      </LegalSection>

      <LegalSection title="12. Quem responde por este tratamento">
        <p>
          O {SERVICE_NAME} é operado por {OPERATOR_LEGAL_NAME}, que atua como
          encarregado pelo tratamento de dados pessoais para os fins do art. 41 da
          LGPD. Contato:{" "}
          <a
            href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
            className="text-foreground underline underline-offset-4"
          >
            {PRIVACY_CONTACT_EMAIL}
          </a>
          .
        </p>
        <p>
          Veja também os{" "}
          <Link href="/termos" className="text-foreground underline underline-offset-4">
            Termos de uso
          </Link>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
