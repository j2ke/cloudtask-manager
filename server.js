require("dotenv").config();
console.log("DB URL:", process.env.DATABASE_URL);
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "clave_temporal",
    resave: false,
    saveUninitialized: false
  })
);

app.use(flash());

app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario;
  res.locals.mensaje = req.flash("mensaje");
  res.locals.error = req.flash("error");
  next();
});

function verificarSesion(req, res, next) {
  if (!req.session.usuario) {
    return res.redirect("/");
  }
  next();
}

function verificarAdmin(req, res, next) {
  if (!req.session.usuario || req.session.usuario.rol !== "admin") {
    req.flash("error", "No tienes permisos para acceder.");
    return res.redirect("/dashboard");
  }
  next();
}

app.get("/", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const resultado = await pool.query(
      "SELECT * FROM usuarios WHERE email = $1 AND estado = true",
      [email]
    );

    if (resultado.rows.length === 0) {
      req.flash("error", "Usuario no encontrado o inactivo.");
      return res.redirect("/");
    }

    const usuario = resultado.rows[0];
    const passwordValida = await bcrypt.compare(password, usuario.password);

    if (!passwordValida) {
      req.flash("error", "Contraseña incorrecta.");
      return res.redirect("/");
    }

    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol
    };

    res.redirect("/dashboard");
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al iniciar sesión.");
    res.redirect("/");
  }
});

app.get("/dashboard", verificarSesion, async (req, res) => {
  try {
    const totalTareas = await pool.query("SELECT COUNT(*) FROM tareas");
    const pendientes = await pool.query(
      "SELECT COUNT(*) FROM tareas WHERE estado = 'pendiente'"
    );
    const proceso = await pool.query(
      "SELECT COUNT(*) FROM tareas WHERE estado = 'en proceso'"
    );
    const finalizadas = await pool.query(
      "SELECT COUNT(*) FROM tareas WHERE estado = 'finalizada'"
    );

    res.render("dashboard", {
      totalTareas: totalTareas.rows[0].count,
      pendientes: pendientes.rows[0].count,
      proceso: proceso.rows[0].count,
      finalizadas: finalizadas.rows[0].count
    });
  } catch (error) {
    console.error(error);
    res.render("dashboard", {
      totalTareas: 0,
      pendientes: 0,
      proceso: 0,
      finalizadas: 0
    });
  }
});

app.get("/tareas", verificarSesion, async (req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT tareas.*, usuarios.nombre AS usuario_nombre
      FROM tareas
      LEFT JOIN usuarios ON tareas.usuario_id = usuarios.id
      ORDER BY tareas.id DESC
    `);

    const usuarios = await pool.query(
      "SELECT id, nombre FROM usuarios WHERE estado = true"
    );

    res.render("tareas", {
      tareas: resultado.rows,
      usuarios: usuarios.rows
    });
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al cargar tareas.");
    res.redirect("/dashboard");
  }
});

app.post("/tareas", verificarSesion, async (req, res) => {
  const { titulo, descripcion, estado, usuario_id } = req.body;

  try {
    await pool.query(
      "INSERT INTO tareas (titulo, descripcion, estado, usuario_id) VALUES ($1, $2, $3, $4)",
      [titulo, descripcion, estado, usuario_id || null]
    );

    req.flash("mensaje", "Tarea creada correctamente.");
    res.redirect("/tareas");
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al crear tarea.");
    res.redirect("/tareas");
  }
});

app.post("/tareas/editar/:id", verificarSesion, async (req, res) => {
  const { id } = req.params;
  const { titulo, descripcion, estado, usuario_id } = req.body;

  try {
    await pool.query(
      "UPDATE tareas SET titulo = $1, descripcion = $2, estado = $3, usuario_id = $4 WHERE id = $5",
      [titulo, descripcion, estado, usuario_id || null, id]
    );

    req.flash("mensaje", "Tarea actualizada correctamente.");
    res.redirect("/tareas");
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al actualizar tarea.");
    res.redirect("/tareas");
  }
});

app.post("/tareas/eliminar/:id", verificarSesion, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM tareas WHERE id = $1", [id]);
    req.flash("mensaje", "Tarea eliminada correctamente.");
    res.redirect("/tareas");
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al eliminar tarea.");
    res.redirect("/tareas");
  }
});

app.get("/usuarios", verificarSesion, verificarAdmin, async (req, res) => {
  try {
    const resultado = await pool.query("SELECT * FROM usuarios ORDER BY id DESC");
    res.render("usuarios", { usuarios: resultado.rows });
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al cargar usuarios.");
    res.redirect("/dashboard");
  }
});

app.post("/usuarios", verificarSesion, verificarAdmin, async (req, res) => {
  const { nombre, email, password, rol } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO usuarios (nombre, email, password, rol) VALUES ($1, $2, $3, $4)",
      [nombre, email, passwordHash, rol]
    );

    req.flash("mensaje", "Usuario creado correctamente.");
    res.redirect("/usuarios");
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al crear usuario.");
    res.redirect("/usuarios");
  }
});

app.post("/usuarios/estado/:id", verificarSesion, verificarAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      "UPDATE usuarios SET estado = NOT estado WHERE id = $1",
      [id]
    );

    req.flash("mensaje", "Estado del usuario actualizado.");
    res.redirect("/usuarios");
  } catch (error) {
    console.error(error);
    req.flash("error", "Error al cambiar estado.");
    res.redirect("/usuarios");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});