/*
 * photo-store.js — dónde viven las fotos de "Dejá tu foto".
 *
 * Storage compartido entre TODOS los visitantes, vía Supabase
 * (Storage + tabla Postgres). Este proyecto es un sitio estático sin
 * build ni servidor propio (GitHub Pages), así que no existe ningún
 * mecanismo real de ".env" — nada procesa esos archivos antes de
 * publicar. La clave "anon" de Supabase está diseñada justamente para
 * vivir en código de cliente (queda visible en el navegador de
 * cualquiera igual): la protección real la dan las policies de Row
 * Level Security configuradas en Supabase, no el secreto de esta
 * clave. Por eso completar las dos constantes de acá abajo es
 * exactamente lo que corresponde en un proyecto así — nunca la
 * "service_role key", esa sí es privada y jamás debe estar en el
 * navegador.
 *
 * PASOS EN SUPABASE (una sola vez, antes de completar las constantes):
 *   1. Crear un proyecto gratis en https://supabase.com
 *   2. Abrir el SQL Editor del proyecto y ejecutar el script que está
 *      en supabase/setup.sql (crea el bucket público "visitor-photos",
 *      la tabla "visitor_photos", sus columnas de posición (x, y,
 *      rotation, scale), las policies —cualquiera puede leer, subir y
 *      mover una foto, nadie puede borrar ni tocar nombre/imagen ajenos—
 *      y habilita Realtime en esa tabla). Si ya lo habías corrido antes
 *      de que existiera la parte de posiciones, volvé a correrlo
 *      entero: es seguro, no rompe nada de lo que ya existía.
 *   3. Ir a Project Settings > API y copiar:
 *        - "Project URL"      -> SUPABASE_URL
 *        - "anon public" key  -> SUPABASE_ANON_KEY
 *      (la "service_role" NO se toca acá).
 *   4. Pegar esos dos valores abajo. Con eso, esta misma página empieza
 *      a guardar y mostrar las fotos de todos los visitantes.
 *
 * Mientras estas dos constantes estén vacías, PhotoStore sigue
 * funcionando con localStorage (privado de este navegador) para que
 * la función se pueda probar, y la página lo avisa honestamente. En
 * ese modo local, updatePosition() guarda en localStorage no más, y
 * subscribePositions() no hace nada (no hay con quién sincronizar).
 */
var SUPABASE_URL = 'https://xbzfqsmjgyxfndsmbrsl.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_2VZX5k8PsfKa4SfFeXsf3Q_d_Y8QpyF';

var PhotoStore = (function () {
  var LOCAL_KEY = 'mi-casa-deja-tu-foto';
  var BUCKET = 'visitor-photos';
  var TABLE = 'visitor_photos';

  var remoteEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
  var client = remoteEnabled ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  function localList() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function localSave(photo) {
    var list = localList();
    list.unshift(photo); // más reciente primero, igual que el modo remoto
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
    } catch (e) { /* localStorage lleno o bloqueado: la foto solo queda en memoria de esta sesión */ }
    return Promise.resolve(photo);
  }

  function dataURLToBlob(dataURL) {
    var parts = dataURL.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var binary = atob(parts[1]);
    var arr = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // nombre para MOSTRAR: solo letras (de cualquier idioma), números,
  // espacios, guiones y guion bajo — nada que pueda romper HTML o rutas
  function sanitizeDisplayName(raw) {
    var n = (raw || '').normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').trim();
    if (!n) n = 'img_' + Math.floor(Math.random() * 900 + 100);
    return n.slice(0, 24);
  }

  // versión "slug" del mismo nombre, para el archivo en el storage:
  // único y sin caracteres raros, aunque el nombre visible tenga tildes/espacios
  function slugify(name) {
    var s = name
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (s || 'foto').slice(0, 40);
  }

  return {
    isRemote: function () { return remoteEnabled; },

    list: function () {
      if (remoteEnabled) {
        return client
          .from(TABLE)
          .select('id, filename, image_url, created_at, x, y, rotation, scale')
          .order('created_at', { ascending: false })
          .then(function (res) {
            if (res.error) throw res.error;
            return (res.data || []).map(function (row) {
              return {
                id: row.id,
                name: row.filename.replace(/\.jpg$/i, ''),
                image: row.image_url,
                created_at: row.created_at,
                x: row.x, y: row.y, rotation: row.rotation, scale: row.scale
              };
            });
          });
      }
      return Promise.resolve(localList());
    },

    // position = { x, y, rotation, scale } — posición inicial elegida
    // por quien llama (el HTML sabe el tamaño real del espacio; acá
    // solo se persiste tal cual, compartida para todos los visitantes)
    save: function (rawName, dataURL, position) {
      var displayName = sanitizeDisplayName(rawName);
      var pos = position || {};
      var createdAt = new Date().toISOString();

      if (remoteEnabled) {
        var storagePath = slugify(displayName) + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.jpg';
        var blob = dataURLToBlob(dataURL);

        return client.storage.from(BUCKET)
          .upload(storagePath, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
          .then(function (uploadRes) {
            if (uploadRes.error) throw uploadRes.error;
            var pub = client.storage.from(BUCKET).getPublicUrl(storagePath);
            var publicUrl = pub && pub.data ? pub.data.publicUrl : '';
            return client.from(TABLE)
              .insert({
                filename: displayName + '.jpg',
                image_url: publicUrl,
                x: pos.x, y: pos.y, rotation: pos.rotation, scale: pos.scale
              })
              .select('id, created_at')
              .single()
              .then(function (insertRes) {
                if (insertRes.error) throw insertRes.error;
                return {
                  id: insertRes.data.id,
                  name: displayName,
                  image: publicUrl,
                  created_at: insertRes.data.created_at,
                  x: pos.x, y: pos.y, rotation: pos.rotation, scale: pos.scale
                };
              });
          });
      }

      return localSave({
        id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name: displayName,
        image: dataURL,
        created_at: createdAt,
        x: pos.x, y: pos.y, rotation: pos.rotation, scale: pos.scale
      });
    },

    // patch = { x, y } (o también rotation/scale si algún día hiciera
    // falta) — se llama al soltar una foto arrastrada. Nunca toca
    // filename/image_url: en modo remoto eso además está bloqueado por
    // el grant de columnas en supabase/setup.sql.
    updatePosition: function (id, patch) {
      if (remoteEnabled) {
        return client.from(TABLE).update(patch).eq('id', id).then(function (res) {
          if (res.error) throw res.error;
        });
      }
      var list = localList();
      var found = list.filter(function (p) { return p.id === id; })[0];
      if (found) {
        for (var key in patch) { if (patch.hasOwnProperty(key)) found[key] = patch[key]; }
        try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch (e) {}
      }
      return Promise.resolve();
    },

    // avisa cuando OTRO cliente (o esta misma pestaña) mueve una foto,
    // vía Supabase Realtime — onUpdate recibe la fila nueva completa.
    // devuelve una función para cancelar la suscripción.
    subscribePositions: function (onUpdate) {
      if (!remoteEnabled) return function () {};
      var channel = client
        .channel('visitor_photos_positions')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE }, function (payload) {
          onUpdate(payload.new);
        })
        .subscribe();
      return function () { client.removeChannel(channel); };
    }
  };
})();
