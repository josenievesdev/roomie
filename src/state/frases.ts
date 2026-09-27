// Frases del chat seguro. Módulo PURO compartido: el cliente enseña el menú y
// el servidor sólo acepta un id de esta lista. El texto lo pone el servidor,
// no el cliente, así que por aquí no se cuela nada.
//
// Los niños sólo hablan con estas frases (ver `src/state/normas.ts`), pero
// son de todos: es la forma rápida de decir algo, también en el móvil.
//
// Español neutro y sin género: "¿Te aburres?" en vez de "¿Estás aburrido?".

export type Frase = { id: string; texto: string };
export type Categoria = { id: string; titulo: string; frases: Frase[] };

export const CATEGORIAS: Categoria[] = [
  {
    id: "saludos",
    titulo: "Saludos",
    frases: [
      { id: "hola", texto: "¡Hola!" },
      { id: "hola-todos", texto: "¡Hola a todos!" },
      { id: "buenas", texto: "¡Buenas!" },
      { id: "adios", texto: "¡Adiós!" },
      { id: "hasta-luego", texto: "¡Hasta luego!" },
      { id: "hasta-manana", texto: "¡Hasta mañana!" },
    ],
  },
  {
    id: "preguntas",
    titulo: "Preguntas",
    frases: [
      { id: "que-tal", texto: "¿Qué tal?" },
      { id: "como-va", texto: "¿Cómo te va?" },
      { id: "que-haces", texto: "¿Qué haces?" },
      { id: "jugamos", texto: "¿Jugamos?" },
      { id: "otra-sala", texto: "¿Vamos a otra sala?" },
      { id: "te-gusta-ropa", texto: "¿Te gusta mi ropa?" },
      { id: "sala-favorita", texto: "¿Qué sala te gusta más?" },
    ],
  },
  {
    id: "respuestas",
    titulo: "Respuestas",
    frases: [
      { id: "si", texto: "Sí" },
      { id: "no", texto: "No" },
      { id: "dale", texto: "¡Dale!" },
      { id: "claro", texto: "¡Claro!" },
      { id: "quizas", texto: "Quizás" },
      { id: "ahora-no", texto: "Ahora no" },
      { id: "gracias", texto: "¡Gracias!" },
      { id: "de-nada", texto: "De nada" },
      { id: "perdon", texto: "Perdón" },
    ],
  },
  {
    id: "animo",
    titulo: "Ánimo",
    frases: [
      { id: "genial", texto: "¡Genial!" },
      { id: "divertido", texto: "¡Qué divertido!" },
      { id: "jaja", texto: "¡Jajaja!" },
      { id: "me-aburro", texto: "Me aburro" },
      { id: "que-lindo", texto: "¡Qué lindo!" },
      { id: "guau", texto: "¡Guau!" },
    ],
  },
  {
    id: "cumplidos",
    titulo: "Cumplidos",
    frases: [
      { id: "buen-estilo", texto: "¡Qué buen estilo!" },
      { id: "me-encanta-ropa", texto: "¡Me encanta tu ropa!" },
      { id: "lindo-peinado", texto: "¡Qué lindo peinado!" },
      { id: "sala-bonita", texto: "¡Qué sala tan bonita!" },
      { id: "buen-plan", texto: "¡Buen plan!" },
    ],
  },
  {
    id: "planes",
    titulo: "Planes",
    frases: [
      { id: "sigueme", texto: "¡Sígueme!" },
      { id: "esperame", texto: "¡Espérame!" },
      { id: "vamos", texto: "¡Vamos!" },
      { id: "vuelvo", texto: "Vuelvo enseguida" },
      { id: "me-voy", texto: "Me tengo que ir" },
      { id: "nos-vemos", texto: "¡Nos vemos!" },
    ],
  },
];

/**
 * Gestos: el emoji viaja como una frase más. Antes eran texto libre, y un
 * niño no habría podido ni saludar.
 */
export const GESTOS: Frase[] = [
  { id: "g-saludo", texto: "👋" },
  { id: "g-feliz", texto: "😀" },
  { id: "g-risa", texto: "😂" },
  { id: "g-corazon", texto: "❤️" },
  { id: "g-bien", texto: "👍" },
  { id: "g-fiesta", texto: "🎉" },
];

/** El gesto de saludar también mueve la mano del avatar */
export const GESTO_SALUDO = "g-saludo";

const TODAS = new Map<string, Frase>(
  [...CATEGORIAS.flatMap((c) => c.frases), ...GESTOS].map((f) => [f.id, f]),
);

/** La frase de ese id, o undefined si no está en el catálogo */
export function frasePorId(id: unknown): Frase | undefined {
  return typeof id === "string" ? TODAS.get(id) : undefined;
}
