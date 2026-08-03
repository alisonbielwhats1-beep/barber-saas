import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalSection, LegalShell } from "../legal-shell";
import {
  OPERATOR_JURISDICTION,
  OPERATOR_LEGAL_NAME,
  PRIVACY_CONTACT_EMAIL,
  SERVICE_NAME,
  SERVICE_URL,
} from "@/lib/legal";

export const metadata: Metadata = {
  title: `Termos de Uso — ${SERVICE_NAME}`,
  description:
    "Condições de uso do SalonSaaS: o que o serviço faz, o que se espera de você e os limites de responsabilidade.",
};

/**
 * Descreve o serviço como ele existe hoje, incluindo o que ainda não funciona
 * (seção 3). Termo que promete recurso inexistente cria expectativa que o
 * software não cumpre — e é o dono do estabelecimento quem fica exposto na
 * frente do cliente dele quando isso acontece.
 */
export default function TermosPage() {
  return (
    <LegalShell
      title="Termos de Uso"
      intro="Estas condições regem o uso do SalonSaaS. Ao criar uma conta ou utilizar o serviço, você concorda com elas. Leia com atenção a seção 3, que descreve com franqueza o que o sistema ainda não faz."
    >
      <LegalSection title="1. Quem oferece o serviço">
        <p>
          O {SERVICE_NAME}, disponível em{" "}
          <a
            href={SERVICE_URL}
            className="text-foreground underline underline-offset-4"
            rel="noopener noreferrer"
          >
            {SERVICE_URL}
          </a>
          , é operado por {OPERATOR_LEGAL_NAME}, pessoa física, doravante
          &ldquo;nós&rdquo;. O documento de identificação fiscal da parte contratante
          pode ser solicitado a qualquer momento pelo e-mail de contato e é informado
          em eventual instrumento contratual — não o publicamos aqui por segurança.
        </p>
      </LegalSection>

      <LegalSection title="2. O que o serviço faz">
        <p>
          O {SERVICE_NAME} é um sistema de gestão e agendamento para
          estabelecimentos de beleza e bem-estar — barbearias, salões, manicures,
          estética e espaços mistos. Ele oferece agenda, cadastro de clientes,
          catálogo de serviços e produtos, controle financeiro, pacotes e uma página
          pública de agendamento para os clientes do estabelecimento.
        </p>
      </LegalSection>

      <LegalSection title="3. O que o serviço ainda não faz">
        <p>
          Preferimos dizer isso de forma clara a deixar você descobrir depois, na
          frente do seu cliente:
        </p>
        <LegalList
          items={[
            <>
              <strong className="text-foreground">
                Lembretes não são enviados automaticamente.
              </strong>{" "}
              O sistema reúne os atendimentos do dia seguinte e monta a mensagem, mas
              o envio pelo WhatsApp é feito por você, manualmente. Não há integração
              ativa de disparo automático.
            </>,
            <>
              <strong className="text-foreground">
                Convites de equipe por e-mail estão indisponíveis
              </strong>{" "}
              enquanto a integração de envio não estiver configurada.
            </>,
            <>
              <strong className="text-foreground">
                Não processamos pagamentos dos seus clientes.
              </strong>{" "}
              O módulo financeiro registra o que foi recebido; ele não é meio de
              pagamento nem intermedia valores entre você e quem você atende.
            </>,
            <>
              <strong className="text-foreground">
                Não garantimos disponibilidade ininterrupta.
              </strong>{" "}
              Não há SLA. O serviço pode ficar indisponível por manutenção, falha de
              fornecedor ou correção de defeito.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Sua conta">
        <LegalList
          items={[
            "Você precisa ter ao menos 18 anos e fornecer informações verdadeiras ao se cadastrar.",
            "Você é responsável por manter sua senha em sigilo e por tudo que acontecer na sua conta.",
            "Ao convidar alguém da sua equipe, você define o papel e o nível de acesso dessa pessoa — e responde por essa escolha.",
            "Avise imediatamente se suspeitar de acesso não autorizado.",
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Sua responsabilidade sobre os dados dos seus clientes">
        <p>
          Esta é a obrigação mais importante deste documento. Ao cadastrar clientes
          no sistema, <strong className="text-foreground">você é o controlador</strong>{" "}
          desses dados perante a LGPD, e nós apenas os processamos sob sua instrução.
          Isso significa que cabe a você:
        </p>
        <LegalList
          items={[
            "Ter base legal para tratar os dados que cadastra, e informar seus clientes sobre isso.",
            "Responder aos pedidos de acesso, correção e exclusão que seus clientes fizerem.",
            "Redobrar o cuidado ao registrar informação de saúde no campo de observações — alergia, condição de pele, reação a produto. Isso é dado sensível e exige consentimento específico.",
            "Não usar os dados para finalidade diversa daquela informada ao cliente, incluindo envio de mensagens que ele não autorizou.",
          ]}
        />
        <p>
          Como esses dados são seus e de seus clientes, respondemos apenas pela
          segurança da infraestrutura — não pelo conteúdo que você cadastra nem pelo
          uso que faz dele. Detalhes em nossa{" "}
          <Link href="/privacidade" className="text-foreground underline underline-offset-4">
            Política de Privacidade
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="6. Uso proibido">
        <p>Não é permitido:</p>
        <LegalList
          items={[
            "Usar o serviço para atividade ilegal, fraudulenta ou que viole direito de terceiro.",
            "Tentar acessar dados de outro estabelecimento, contornar controles de permissão ou explorar falhas de segurança.",
            "Automatizar acesso de forma a sobrecarregar a infraestrutura, ou burlar os limites de requisição.",
            "Enviar mensagem não solicitada em massa a partir dos contatos cadastrados.",
            "Publicar imagem ou texto de que você não detenha os direitos, inclusive no portfólio e na página pública.",
            "Revender ou sublicenciar o acesso ao sistema sem autorização.",
          ]}
        />
      </LegalSection>

      <LegalSection title="7. Preço">
        <p>
          O serviço é oferecido gratuitamente no momento, e não há cobrança
          implementada no sistema. Caso planos pagos passem a existir, avisaremos com
          antecedência mínima de 30 dias pelos canais de contato, e o uso continuado
          após esse prazo significará aceite das novas condições. Nenhuma cobrança
          será feita sem seu aceite prévio e expresso.
        </p>
      </LegalSection>

      <LegalSection title="8. Conteúdo e propriedade">
        <p>
          O conteúdo que você cadastra — dados, textos, imagens e configurações —
          continua sendo seu. Você nos concede apenas a licença técnica necessária
          para armazenar e exibir esse conteúdo no funcionamento do serviço, inclusive
          na sua página pública de agendamento.
        </p>
        <p>
          O software, a marca e a interface do {SERVICE_NAME} são nossos. Estes
          Termos não transferem nenhum direito sobre eles.
        </p>
      </LegalSection>

      <LegalSection title="9. Encerramento">
        <LegalList
          items={[
            "Você pode encerrar sua conta quando quiser, solicitando pelo e-mail de contato.",
            "Podemos suspender ou encerrar contas que violem estes Termos, em regra após aviso — salvo quando a gravidade ou uma ordem legal exigir ação imediata.",
            "Podemos descontinuar o serviço, e nesse caso avisaremos com antecedência mínima de 30 dias, com prazo razoável para você exportar seus dados.",
            "Encerrada a conta, os dados são apagados conforme a Política de Privacidade.",
          ]}
        />
      </LegalSection>

      <LegalSection title="10. Limitação de responsabilidade">
        <p>
          O serviço é fornecido no estado em que se encontra. Na máxima extensão
          permitida pela lei, não respondemos por lucros cessantes, perda de clientela
          ou dano indireto decorrente do uso ou da indisponibilidade do serviço.
        </p>
        <p>
          Nada aqui afasta as garantias legais que não podem ser afastadas por
          contrato, nem nossa responsabilidade por dolo ou culpa grave. Se você
          contrata como consumidor, seus direitos sob o Código de Defesa do Consumidor
          permanecem íntegros.
        </p>
        <p>
          Recomendamos manter cópia própria das informações que forem críticas para
          o seu negócio.
        </p>
      </LegalSection>

      <LegalSection title="11. Alterações destes Termos">
        <p>
          Podemos alterar estes Termos. A data no topo indica a versão vigente.
          Mudança relevante será comunicada com antecedência, e o uso continuado
          após a entrada em vigor significa aceite.
        </p>
      </LegalSection>

      <LegalSection title="12. Lei aplicável e foro">
        <p>
          Estes Termos são regidos pela lei brasileira. Fica eleito o foro de{" "}
          {OPERATOR_JURISDICTION} para dirimir controvérsias, ressalvado o direito do
          consumidor de demandar no foro de seu domicílio.
        </p>
        <p>
          Contato para qualquer assunto relativo a estes Termos:{" "}
          <a
            href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
            className="text-foreground underline underline-offset-4"
          >
            {PRIVACY_CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
