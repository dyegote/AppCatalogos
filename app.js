// App para extraer datos desde archivos HTML subidos por el usuario
// Sigue las reglas de EspecificacionInicial.txt (selectores y limpieza)
(function(){
  const fileInput = document.getElementById('fileInput');
  const tbody = document.querySelector('#results tbody');
  const filterTypo = document.getElementById('filterTypo');
  const filterCategoria = document.getElementById('filterCategoria');
  const filterSubcategoria = document.getElementById('filterSubcategoria');
  const clearBtn = document.getElementById('clearBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const searchInput = document.getElementById('search');

  let rows = [];

  function insertSpaceCamel(str){
    // Inserta espacio cuando cambia de minúscula a mayúscula y limpia guiones bajos/hyphens
    return str.replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g,'$1 $2').replace(/[-_]+/g,' ').trim();
  }

  function parseFileNameForParts(filename){
    const name = filename.replace(/\.[^.]+$/,'');
    const parts = name.split('_');
    const [t='', c='', s=''] = parts;
    return {TYPO: insertSpaceCamel(t), CATEGORIA: insertSpaceCamel(c), SUBCATEGORIA: insertSpaceCamel(s)};
  }

  function cleanText(text){
    if(!text) return '';
    return text.replace(/\s+/g,' ').trim();
  }

  function extractCodeFromName(text){
    const m = text.match(/\[\s*([^\]]+?)\s*\]/);
    return m? m[1].trim() : '';
  }

  function removeBracketCode(text){
    return text.replace(/\[.*?\]/g,'');
  }

  function extractFieldFromShortDesc(text, label){
    const re = new RegExp(label+'\s*[:]?\s*([0-9]{1,}|[0-9]{1,}% )','i');
    // Try simpler:
    const m = text.match(new RegExp(label+'\s*[:]?\s*([0-9]+%?)','i'));
    return m? m[1].trim() : '';
  }

  function toBasename(path){
    if(!path) return '';
    return path.replace(/\\/g,'/').split('/').pop();
  }

  function joinPath(fileName, imageRel){
    // Simula os.path.join + normpath: usa nombre del archivo (sin extension) como "dir"
    const dir = fileName.replace(/\\/g,'/').replace(/\.[^.]+$/,'');
    if(!imageRel) return dir + '/' + toBasename(imageRel);
    // limpiar prefijos ./
    const p = imageRel.replace(/^\.\//,'').replace(/\\/g,'/');
    const joined = dir + '/' + p;
    // normalizar repetidos de '/'
    return joined.replace(/\/+/g, '/');
  }

  function normalizePrice(text){
    if(!text) return '';
    // quitar simbolos y espacios iniciales
    let t = text.replace(/[^0-9.,]/g,'').trim();
    // si contiene '.' como separador de miles, convertir '.'->',' (según especificacion)
    // pero si tiene decimales con '.', prefer mantener. Heurística: si hay más de one '.' and no ',', treat as thousands sep
    const dots = (t.match(/\./g)||[]).length;
    const commas = (t.match(/,/g)||[]).length;
    if(dots>1 && commas===0){
      t = t.replace(/\./g,',');
    }
    return t;
  }

  function parseDocument(docText, archivoName){
    const parser = new DOMParser();
    const doc = parser.parseFromString(docText,'text/html');
    let productItems = doc.querySelectorAll('.product-item');
    const generalParts = parseFileNameForParts(archivoName);
    if(productItems.length===0){
      // fallback: intentar buscar por h3.product-name
      const names = doc.querySelectorAll('h3.product-name');
      if(names.length===0){
        console.log('No se encontraron productos en', archivoName);
        return [];
      }
      // crear un pseudo item por cada nombre usando cercano description/selectors
      productItems = names;
    }

    const results = [];
    productItems.forEach(item => {
      try{
        // permitir que item sea .product-item o un h3
        const container = (item.classList && item.classList.contains('product-item')) ? item : item.closest('.product-item') || item.parentElement;
        const nameEl = container.querySelector('h3.product-name a') || container.querySelector('h3.product-name');
        // intentar obtener un enlace al producto (varias posibles ubicaciones/clases)
        const linkEl = container.querySelector('h3.product-name a') || container.querySelector('a.hover-invert') || container.querySelector('a.product-details-button') || container.querySelector('a');
        const productUrl = linkEl ? (linkEl.getAttribute('href') || '') : '';
        const fullName = nameEl? nameEl.textContent : '';
        const codigo = extractCodeFromName(fullName);
        const nombre_producto = cleanText(removeBracketCode(fullName));

                const descEl = container.querySelector('div.product-short-desc-cont');
        const descRaw = descEl? descEl.textContent : '';
        // extraer MARCA (Marca: ...). Usar textContent para evitar capturas erróneas por HTML mezclado
        let MARCA = '';
        if(descEl){
          // intentar extraer marca directamente del innerHTML tomando sólo hasta la siguiente etiqueta
          const html = descEl.innerHTML || '';
          const marcaPos = html.search(/Marca\s*[:：]/i);
          if(marcaPos >= 0){
            const rest = html.slice(marcaPos);
            const nextTag = rest.indexOf('<');
            const snippet = nextTag >= 0 ? rest.slice(0,nextTag) : rest;
            MARCA = snippet.replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/Marca\s*[:：]\s*/i,'').trim();
          } else {
            // fallback a textContent buscando hasta MOQ/CTN/Arancel/IVA
            const text = descEl.textContent || '';
            const marcaIdx = text.search(/Marca\s*[:：]/i);
            if(marcaIdx >= 0){
              const after = text.slice(marcaIdx).replace(/Marca\s*[:：]\s*/i, '');
              const m = after.match(/([^\r\n]*?)(?=\s*(MOQ|CTN|Arancel|IVA|$))/i);
              if(m && m[1]) MARCA = m[1].trim();
            }
          }
        }
        let descripcion = cleanText(removeBracketCode(descRaw));
        // eliminar MARCA del texto sin eliminar contenido extra: si se detectó MARCA, remover solo esa ocurrencia
        if(MARCA){
          const esc = MARCA.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&');
          descripcion = descripcion.replace(new RegExp('Marca[:]?[\\s]*'+esc,'i'),'');
        } else {
          descripcion = descripcion.replace(/Marca[:]?[\\s]*[^\\n\\r<]*/i,'');
        }
        // eliminar duplicado del nombre del producto al inicio de la descripción
        if(nombre_producto){
          const esc = nombre_producto.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
          descripcion = descripcion.replace(new RegExp('^\\s*'+esc+'\\s*','i'),'');
        }
        // eliminar prefijos/puntuación sobrante al inicio
        descripcion = descripcion.replace(/^["'\-:\s]+/,'');
        // eliminar etiquetas MOQ/CTN/IVA/ARANCEL del texto final
        descripcion = descripcion.replace(/MOQ[:]?[\s]*\d+/ig,'').replace(/CTN[:]?[\s]*\d+/ig,'').replace(/IVA[:]?[\s]*\d+%/ig,'').replace(/Arancel[:]?[\s]*\d+%/ig,'');
        descripcion = cleanText(descripcion);

        // extraer campos
        const moqMatch = descRaw.match(/MOQ[:]?\s*(\d+)/i);
        const ctnMatch = descRaw.match(/CTN[:]?\s*(\d+)/i);
        const ivaMatch = descRaw.match(/IVA[:]?\s*(\d+%)/i);
        const arancelMatch = descRaw.match(/Arancel[:]?\s*(\d+%)/i);
        const MOQ = moqMatch? moqMatch[1].trim(): '';
        const CTN = ctnMatch? ctnMatch[1].trim(): '';
        const IVA = ivaMatch? ivaMatch[1].trim(): '';
        const ARANCEL = arancelMatch? arancelMatch[1].trim(): '';

        const priceEl = container.querySelector('span.PricesalesPrice') || container.querySelector('.PricesalesPrice');
        const precio = normalizePrice(priceEl? priceEl.textContent : '');

        const imgEl = container.querySelector('div.product-image-cont img');
        const imagen_relativa = imgEl? imgEl.getAttribute('src') || imgEl.src : '';

        results.push({
          archivo_origen: archivoName,
          TYPO: generalParts.TYPO,
          CATEGORIA: generalParts.CATEGORIA,
          SUBCATEGORIA: generalParts.SUBCATEGORIA,
          codigo: codigo,
          nombre_producto: nombre_producto,
          MARCA: MARCA,
          precio: precio,
          MOQ: MOQ,
          CTN: CTN,
          ARANCEL: ARANCEL,
          IVA: IVA,
          imagen_relativa: imagen_relativa,
          product_url: productUrl
        });
      }catch(err){
        console.log('Error procesando item en', archivoName, err);
      }
    });
    return results;
  }

  function render(){
    tbody.innerHTML = '';
    const fTypo = filterTypo.value;
    const fCat = filterCategoria.value;
    const fSub = filterSubcategoria.value;
    const q = searchInput.value.trim().toLowerCase();

    rows.filter(r => {
      if(fTypo && r.TYPO!==fTypo) return false;
      if(fCat && r.CATEGORIA!==fCat) return false;
      if(fSub && r.SUBCATEGORIA!==fSub) return false;
      if(q){
        const hay = Object.values(r).join(' ').toLowerCase().includes(q);
        if(!hay) return false;
      }
      return true;
    }).forEach(r => {
      const tr = document.createElement('tr');
      ['codigo','nombre_producto','MARCA','TYPO','CATEGORIA','SUBCATEGORIA','precio','MOQ','CTN','ARANCEL','IVA','imagen_relativa','archivo_origen'].forEach(k=>{
        const td = document.createElement('td');
        if(k === 'nombre_producto' && r.product_url){
          const a = document.createElement('a');
          a.href = r.product_url;
          a.textContent = r[k]||'';
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          td.appendChild(a);
        } else {
          td.textContent = r[k]||'';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function updateFilters(){
    const typos = Array.from(new Set(rows.map(r=>r.TYPO).filter(Boolean))).sort();
    const cats = Array.from(new Set(rows.map(r=>r.CATEGORIA).filter(Boolean))).sort();
    const subs = Array.from(new Set(rows.map(r=>r.SUBCATEGORIA).filter(Boolean))).sort();
    function populate(select, items){
      const cur = select.value;
      select.innerHTML = '<option value="">(Todos)</option>' + items.map(i=>`<option>${i}</option>`).join('');
      if(items.includes(cur)) select.value = cur;
    }
    populate(filterTypo, typos);
    populate(filterCategoria, cats);
    populate(filterSubcategoria, subs);
  }

  function handleFiles(fileList){
    const files = Array.from(fileList).filter(f=>/\.html?$|\.htm$/i.test(f.name));
    if(files.length===0) return;
    let pending = files.length;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try{
          const res = parseDocument(e.target.result, file.name);
          rows = rows.concat(res);
        }catch(err){
          console.log('Error leyendo', file.name, err);
        }finally{
          pending--; if(pending===0){ updateFilters(); render(); }
        }
      };
      reader.onerror = (e)=>{ console.log('FileReader error', file.name, e); pending--; if(pending===0){ updateFilters(); render(); } };
      reader.readAsText(file, 'utf-8');
    });
  }

  fileInput.addEventListener('change', (e)=>{
    handleFiles(e.target.files);
  });

  clearBtn.addEventListener('click', ()=>{ rows=[]; tbody.innerHTML=''; updateFilters(); fileInput.value=''; searchInput.value=''; });

  [filterTypo,filterCategoria,filterSubcategoria,searchInput].forEach(el=>el.addEventListener('input', render));

  exportCsvBtn.addEventListener('click', ()=>{
    if(rows.length===0) return alert('No hay datos a exportar');
    const cols = ['codigo','nombre_producto','MARCA','TYPO','CATEGORIA','SUBCATEGORIA','precio','MOQ','CTN','ARANCEL','IVA','imagen_relativa','archivo_origen'];
    const headerLabels = ['CODIGO','NOMBRE_PRODUCTO','MARCA','TYPO','CATEGORIA','SUBCATEGORIA','PRECIO','MOQ','CTN','ARANCEL','IVA','IMAGEN_RELATIVA','ARCHIVO_ORIGEN'];
    const lines = [headerLabels.join(',')].concat(rows.map(r=>cols.map(c=>`"${(r[c]||'').toString().replace(/"/g,'""')}"`).join(',')));
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'productos.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
})();
