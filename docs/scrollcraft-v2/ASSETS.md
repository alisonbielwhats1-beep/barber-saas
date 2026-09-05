# Assets autorais

Imagens geradas pela ferramenta nativa, sob autorização do usuário. Nenhum asset copiado das referências.

- `public/images/atelier-plate.webp`: arquitetura distante, 33.532 bytes.
- `public/images/atelier-glass.webp`: primeiro plano, 118.398 bytes; alpha RGBA verificado de 0 a 255, sem fundo xadrez.
- `public/images/product-concept.webp`: imagem conceitual, separada das fotografias. A legenda informa que a interface atual é diferente; não representa screenshot do produto.
- `public/images/atelier-motion.webm`: vídeo autoral de luz, aproximadamente oito segundos, VP9, 573.768 bytes. Renderizado localmente pelo shader em `scripts/render-ambient-video.mjs`. Não é filmagem de pessoas nem vídeo gerado por Kie/Higgsfield. Sem áudio. Carrega apenas com cena visível e movimento habilitado; falha de reprodução mantém a composição estática funcional.

As cinco fotografias `brand-*.webp` foram geradas na primeira etapa e continuam como planos dos respectivos segmentos. As capturas antigas `product-agenda-*.webp` não são mais usadas na landing.

## Prompts enviados

### atelier

Create a premium photoreal architectural background plate for a beauty and wellness SaaS website. Landscape 16:9. An enormous serene contemporary atelier, ivory plaster softly curved walls, two tall softly rounded portal openings at the extreme left and right, a pale polished stone floor in the bottom 30%, cool daylight and subtle champagne highlights. Center upper 65% is exceptionally clean empty softly shaded ivory negative space for HTML headline, no furniture, no people, no text, no logo, no interface, no plants. Quiet European beauty editorial art direction, tactile real architecture, soft natural photographic shadows, spatial depth. The center must be open, side architecture frames it. This will be a distant parallax plane.

### glass

Generate a photoreal 3D foreground compositing asset on a genuinely TRANSPARENT BACKGROUND with alpha. Wide landscape 16:9. Two sculptural waves of clear ribbed optical glass at the far bottom-left and far bottom-right corners, curved like the edges of a sophisticated glass room divider. The two pieces are separate, leaving the central 65% and upper 65% COMPLETELY TRANSPARENT. Silver reflections with subtle champagne refractions, no green, no blue. Highest photographic material quality, delicate fluted edges and translucent glass, beauty editorial luxury architecture, not a cartoon. No floor, no room, no people, no shadows on background, no text, no UI. Glass extends beyond the bottom and side edges, reaching no higher than 50% of image at the extreme sides. It must be a real cutout overlay to frame a different photograph without covering the center.

### product

Create an extraordinarily refined SaaS product marketing image for SalonSaaS, a beauty establishment management application. Wide 16:9, high resolution, sharp and legible. A single large ultra-thin satin-silver desktop display, straight-on with only a very slight natural perspective, floating just above a minimal pale stone support in a warm white photographic studio. The display fills 85% of composition. On its screen: an impeccably designed WHITE weekly appointment calendar, understated charcoal typography, hairline rules, elegant rounded rectangular appointment blocks in muted lavender and soft peach, spacious navigation. Visible actual feature labels only: 'SalonSaaS', 'Agenda', 'Clientes', 'Equipe', 'Financeiro'. Calendar columns 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'; header 'Sua semana, organizada.' Small appointment labels 'Corte', 'Manicure', 'Massagem', 'Estética'. No performance metrics, no revenue, no percentages, no avatars, no customer names, no fake testimonial, no AI features, no WhatsApp. Crisp believable Portuguese UI rather than dense dashboard. Do not show any salon, barbershop, person, other photograph, or layered background photo. This is an illustrative product concept, not a screenshot. Realistic hardware, subtle studio shadow, luminous off-white background, no green, no neon, no elaborate decor.
