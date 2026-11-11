# Mi Caja

Registro personal de gastos e ingresos. App instalable (PWA) que funciona sin señal y guarda todo en la planilla
"Finanzas personales (Agustín Marconato)" de Google Sheets. Mismo esquema que Don Enrique:

- **App**: archivos estáticos en GitHub Pages → https://el-ten.github.io/mi-caja/
- **Servidor**: `gas/Code.gs`, pegado en Apps Script dentro de la planilla. Lee y escribe la planilla con una clave.
- **Sin señal**: lo cargado queda en el celular (IndexedDB) y se envía solo cuando vuelve la conexión.

## Instalar el servidor (una sola vez, mejor desde una computadora)

1. Abrir la planilla → **Extensiones → Apps Script**.
2. Borrar lo que haya en `Código.gs` y pegar todo `gas/Code.gs`. Guardar.
3. Elegir la función **configurar** → **Ejecutar** → aceptar permisos. En el registro aparece la **clave**.
4. **Implementar → Nueva implementación** → tipo **Aplicación web** · Ejecutar como: **yo** · Acceso: **Cualquier persona** → Implementar.
5. Copiar la **URL** (termina en `/exec`).
6. En la app: "Conectar con mi planilla" → pegar la URL y la clave.

Para otro celular: Ajustes → "Copiar código de conexión" y pegarlo allá.
Si se cambia `Code.gs`: Implementar → Gestionar implementaciones → editar → Versión nueva (la URL no cambia).
Si la clave se filtró: ejecutar `nuevaClave` y volver a conectar los celulares.

## Reglas que respeta

- No borra filas. Escribe en la primera fila libre de `01_MOVIMIENTOS` (A:R) con las mismas fórmulas de la planilla en C y L.
- Número visible `PER-2609-NNN` correlativo; el ID interno `MC-…` va en la columna R y evita duplicados aunque se reenvíe.
- Ajustes de caja en `04_APP_AJUSTES` con número `AJU-2609-NNN`.
- Cuentas, categorías, formas de pago y subcategorías salen de la planilla (06, 07, 03 y la validación de la columna F).
- Saldo y resumen del mes salen de `05_APP_INICIO`; lo que no se envió se suma aparte como "estimado".
- Correcciones: conservan número, ID y fórmulas; si la fila cambió en la planilla mientras tanto, no la pisa.

## Desarrollo

```
node tools/build.mjs        # genera gas/Code.gs y sella sw.js (hacer antes de cada publicación)
node --test tests/*.test.js # pruebas
python3 -m http.server      # probar en http://localhost:8000 (modo demo)
```

La lógica del servidor está en `js/core.js` y la usan igual Apps Script, el modo demo y las pruebas.
