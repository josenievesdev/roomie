// Puente entre el teclado del sistema y el texto que dibuja Phaser.
//
// Phaser sigue pintando el texto; este <input> real e invisible existe SÓLO
// para que el navegador nos entregue lo que el usuario escribe.
//
// En un móvil es la única manera de que aparezca el teclado: el sistema lo
// muestra cuando hay un elemento editable del DOM con el foco, y un objeto de
// Phaser no lo es. Antes la entrada de texto se capturaba con un
// `keydown` sobre `window`, que en un teléfono no se dispara nunca porque no
// hay teclado físico: el nickname y el chat eran inaccesibles desde el móvil.

export type TextInput = {
  /** El elemento real, para poder comparar contra `document.activeElement` */
  readonly el: HTMLInputElement;
  /** Pide el foco (y con él, el teclado del móvil) */
  focus(): void;
  /** Cambia el valor sin disparar `onChange` */
  setValue(value: string): void;
  destroy(): void;
};

export type TextInputOptions = {
  maxLength: number;
  initial?: string;
  /** "password" oculta el texto y evita que el navegador lo autocorrija */
  type?: "text" | "password";
  /** Qué sugerir al gestor de contraseñas del navegador */
  autocomplete?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Tabulador: saltar al siguiente campo */
  onNext?: () => void;
};

export function createTextInput(opts: TextInputOptions): TextInput {
  const el = document.createElement("input");
  el.type = opts.type ?? "text";
  el.value = opts.initial ?? "";
  el.maxLength = opts.maxLength;
  // En las contraseñas SÍ interesa el gestor del navegador: que ofrezca
  // guardarla y rellenarla es mejor seguridad, no peor.
  el.autocomplete = (opts.autocomplete ?? "off") as AutoFill;
  el.spellcheck = false;
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("enterkeyhint", "send");
  el.setAttribute("aria-hidden", "true");

  el.style.cssText = [
    // Centrado en la ventana para que, al enfocarlo, el móvil no desplace la
    // página buscándolo.
    "position:fixed",
    "left:50%",
    "top:50%",
    "transform:translate(-50%,-50%)",
    "width:200px",
    "height:40px",
    // Invisible pero ENFOCABLE: con `display:none` o `visibility:hidden` el
    // navegador no lo deja enfocar y no saldría el teclado.
    "opacity:0",
    // Que no se coma los toques destinados al lienzo del juego.
    "pointer-events:none",
    "border:0",
    "padding:0",
    "background:transparent",
    "color:transparent",
    // Por debajo de 16px, iOS hace zoom automático al enfocar un input.
    "font-size:16px",
  ].join(";");

  const onInput = (): void => {
    if (el.value.length > opts.maxLength) el.value = el.value.slice(0, opts.maxLength);
    opts.onChange(el.value);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // Mientras este input tiene el foco, el teclado es SUYO: la tecla no debe
    // seguir subiendo hasta window, donde escuchan el respaldo del modal y el
    // teclado de Phaser.
    //
    // Sin esto, el mismo Enter que confirmaba el nickname seguía propagándose:
    // closeLoginModal reactivaba el teclado de Phaser en mitad del recorrido
    // del evento y el manejador abría el chat solo. Enviar un mensaje tenía el
    // mismo problema al revés: cerraba el chat y acto seguido lo reabría.
    e.stopPropagation();

    if (e.key === "Tab" && opts.onNext) {
      e.preventDefault();
      opts.onNext();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      opts.onSubmit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      opts.onCancel();
    }
  };

  el.addEventListener("input", onInput);
  el.addEventListener("keydown", onKeyDown);
  document.body.appendChild(el);

  return {
    el,
    focus() {
      // `preventScroll` evita el salto de la página en móvil
      el.focus({ preventScroll: true });
    },
    setValue(value: string) {
      el.value = value.slice(0, opts.maxLength);
    },
    destroy() {
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeyDown);
      el.blur(); // cierra el teclado del móvil
      el.remove();
    },
  };
}

/** ¿Hay un puente de texto con el foco? Entonces las teclas son suyas. */
export function textInputFocused(...inputs: (TextInput | null)[]): boolean {
  return inputs.some((i) => i !== null && document.activeElement === i.el);
}
