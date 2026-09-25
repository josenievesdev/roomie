# Fase 3 — Login real contra la base de datos

**Fecha:** 24 de septiembre de 2026

## Lo que cambia de fondo

Hasta ahora tu identidad era una cadena en `localStorage`. El cliente le decía
al servidor cómo se llamaba y el servidor se lo creía: el nickname era una
etiqueta que cada uno se ponía, no una identidad. Se borraba al limpiar el
navegador, dos personas podían usar el mismo nombre en salas distintas, y no
había nada que asociar a un saldo o a unos muebles.

Ahora hay cuentas de verdad en Postgres, y **el nombre ya no viaja en `join`**:
sale de la cuenta autenticada.

## Cómo funciona

```
navegador                         servidor                      Postgres
    │                                 │                              │
    ├── auth(usuario, clave) ────────►│                              │
    │                                 ├── ¿demasiados fallos? ──────►│
    │                                 ├── scrypt + comparación ─────►│
    │                                 ├── abrir sesión ─────────────►│
    │◄──── authOk(token, nick, look, saldo)                          │
    │                                 │                              │
    ├── join(sala, posición) ────────►│  (el nombre lo pone él)      │
```

Al recargar, el navegador manda el **token** guardado y el servidor reanuda sin
pedir la contraseña. El token es lo único de tu identidad que guarda el
navegador: nombre, aspecto y saldo vienen siempre del servidor.

## Decisiones que importan

**El token se guarda hasheado.** En `sessions` va el SHA-256, nunca el token en
claro. Si la base se filtrara, los tokens guardados no sirven para entrar. Es
el mismo razonamiento que con las contraseñas.

**Contraseñas con scrypt de `node:crypto`.** Es un KDF serio (lento a
propósito, con sal y coste de memoria) y no arrastra una dependencia nativa,
que en Windows es una fuente garantizada de problemas al instalar. La
comparación es de tiempo constante.

**Entrar tarda lo mismo exista o no la cuenta.** Si el usuario no existe se
verifica igualmente contra un hash de pega, para que el tiempo de respuesta no
delate qué usuarios están registrados.

**Freno a la fuerza bruta.** `login_attempts` cuenta los fallos por nombre
*tecleado*, no por cuenta: así también frena los intentos contra usuarios que
no existen, que es justo lo que hace un ataque de diccionario. Ocho fallos en
quince minutos cierran la puerta un rato. De paso queda el rastro para poder
responder "¿alguien ha intentado entrar en mi cuenta?".

**Una cuenta, una sesión de juego.** Dos pestañas con la misma cuenta ya no
entran a la vez; la segunda recibe un aviso.

**El aspecto vive en la cuenta.** Cambiar de ropa se guarda en `avatars.look`:
si sólo viviera en memoria, al cerrar sesión volverías a salir con los colores
por defecto.

## El modal

Un solo panel con tres modos: **login** (usuario y contraseña), **registro**
(además nombre en el juego y aspecto) y **perfil** (ya dentro: aspecto y cerrar
sesión).

Cada campo tiene su `<input>` real del navegador, invisible pero enfocable, así
que funciona el teclado del móvil, el tabulador salta de campo y el gestor de
contraseñas puede ofrecer guardar la clave. Las contraseñas se dibujan con
puntos y el `<input>` es de tipo `password`.

**La altura del panel se calcula a partir de su contenido.** Puesta a mano, el
botón acababa montado encima de los selectores de color en el formulario de
registro, que es el más alto.

## Verificación

Contra la base real y en navegador real:

- registro → cuenta creada, 500 monedas, token guardado, entra a la sala
- recargar → reanuda sin pedir contraseña
- contraseña incorrecta → "Usuario o contraseña incorrectos", el modal sigue
- cerrar sesión → token borrado aquí y en el servidor
- entrar de nuevo → sale con la ropa que había guardado antes

Más `typecheck`, `build`, `db:check` (24 comprobaciones) y el smoke E2E, que
ahora **registra cuentas de verdad** antes de entrar, con sufijo único por
ejecución para no chocar consigo mismo.

## Lo que rompe

Quien tuviera un nickname en `localStorage` tendrá que registrarse. No hay
migración posible: esas "cuentas" no tenían contraseña ni dueño.

Y sin base de datos ya no se puede jugar. Antes el juego funcionaba en
single-player sin servidor; ahora la identidad es obligatoria. Es el precio de
tener cuentas.

## Siguiente

El inventario y la tienda ya están en la base (`items`, `catalog_items`,
`ledger`) y probados, pero todavía no hay interfaz: comprar y colocar muebles
es lo que viene ahora.
