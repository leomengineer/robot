# robot

Juego para aprender a programar: armás una secuencia de instrucciones y el robot la ejecuta para juntar las baterías.

```bash
npm install
npm run dev
```

- `src/levels.json`: niveles (`.` piso, `#` piedra, `T` árbol, `S` inicio, `B` batería)
- `src/logic.js`: reglas e intérprete, sin dependencias de render
- `src/render.js`, `src/models.js`, `src/path.js`, `src/celebration.js`: escena 3D (three.js), todo con cajas por ahora
- `src/main.js`, `src/styles.css`: interfaz HTML/CSS
- `2d/`: prototipo 2D original
