export type WorkflowPdfModel = {
  name: string;
  description?: string | null;
  requesterFields?: string[];
  stages: Array<{
    name: string;
    responsible: string;
    duration?: number | null;
    fields: string[];
  }>;
  routes: Array<{
    from: string;
    label: string;
    action: string;
    target: string;
    condition?: string | null;
  }>;
};

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3) {
  const words = String(text || '—').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : ['—'];
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, font: string, maxLines = 2) {
  ctx.font = font;
  ctx.fillText(String(value || '—'), x, y);
  return y + Math.max(1, wrapLines(ctx, value, maxWidth, maxLines).length - 1) * 24;
}

function drawStageBox(ctx: CanvasRenderingContext2D, s: WorkflowPdfModel['stages'][number], index: number, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#0f3b70';
  ctx.font = '700 22px Arial';
  ctx.fillText(`المرحلة ${index + 1}`, x + w - 24, y + 34);
  ctx.fillStyle = '#172033';
  ctx.font = '700 25px Arial';
  ctx.fillText(s.name, x + w - 24, y + 70);
  ctx.fillStyle = '#475467';
  ctx.font = '500 17px Arial';
  ctx.fillText(`مخصصة لـ: ${s.responsible || 'غير محدد'}`, x + w - 24, y + 101);
  if (s.duration) ctx.fillText(`المدة: ${s.duration} دقيقة`, x + w - 24, y + 128);
  ctx.fillStyle = '#667085';
  ctx.font = '600 16px Arial';
  ctx.fillText('عناصر المرحلة:', x + w - 24, y + (s.duration ? 158 : 136));
  const fields = s.fields.length ? s.fields.join('، ') : 'لا توجد عناصر';
  const lines = wrapLines(ctx, fields, w - 48, 2);
  ctx.font = '400 15px Arial';
  lines.forEach((line, i) => ctx.fillText(line, x + w - 24, y + (s.duration ? 183 : 161) + i * 22));
}

function makePage(model: WorkflowPdfModel, page: number, total: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d')!;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let y = 70;
  ctx.fillStyle = '#0b376b';
  ctx.font = '700 34px Arial';
  ctx.fillText(model.name, 1160, y);
  y += 38;
  ctx.fillStyle = '#667085';
  ctx.font = '400 17px Arial';
  const desc = wrapLines(ctx, model.description || 'خارطة سير المعاملة', 1050, 2);
  desc.forEach(line => { ctx.fillText(line, 1160, y); y += 24; });
  y += 18;

  ctx.fillStyle = '#eef5ff';
  ctx.strokeStyle = '#c8d8ec';
  ctx.fillRect(80, y, 1080, 82);
  ctx.strokeRect(80, y, 1080, 82);
  ctx.fillStyle = '#344054';
  ctx.font = '700 18px Arial';
  ctx.fillText('مقدم الطلب', 1125, y + 30);
  ctx.fillStyle = '#172033';
  ctx.font = '500 16px Arial';
  ctx.fillText(model.requesterFields?.length ? model.requesterFields.join('، ') : 'بيانات مقدم الطلب المحددة من النظام', 1125, y + 58);
  y += 112;

  const perPage = 4;
  const start = (page - 1) * perPage;
  const pageStages = model.stages.slice(start, start + perPage);
  ctx.fillStyle = '#172033';
  ctx.font = '700 22px Arial';
  ctx.fillText(`سير المعاملة — صفحة ${page} من ${total}`, 1160, y);
  y += 34;

  pageStages.forEach((s, local) => {
    drawStageBox(ctx, s, start + local, 80, y, 1080, 205);
    y += 225;
    if (local < pageStages.length - 1) {
      ctx.strokeStyle = '#8aa8c8';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(620, y - 12); ctx.lineTo(620, y + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(620, y + 12); ctx.lineTo(611, y + 2); ctx.moveTo(620, y + 12); ctx.lineTo(629, y + 2); ctx.stroke();
      y += 14;
    }
  });

  const relevant = model.routes.filter(r => pageStages.some(s => s.name === r.from));
  if (relevant.length && y < 1450) {
    ctx.fillStyle = '#172033';
    ctx.font = '700 21px Arial';
    ctx.fillText('الشروط والمسارات', 1160, y + 5);
    y += 35;
    relevant.slice(0, 6).forEach((r, i) => {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#f8fafc';
      ctx.strokeStyle = '#e4e7ec';
      ctx.fillRect(80, y, 1080, 74);
      ctx.strokeRect(80, y, 1080, 74);
      ctx.fillStyle = '#344054';
      ctx.font = '700 15px Arial';
      ctx.fillText(`${r.from} → ${r.target}`, 1125, y + 25);
      ctx.fillStyle = '#475467';
      ctx.font = '400 14px Arial';
      const condition = r.condition || 'بدون شرط — المسار الافتراضي';
      ctx.fillText(`إذا: ${condition}`, 1125, y + 50);
      y += 84;
    });
  }

  ctx.fillStyle = '#98a2b3';
  ctx.font = '400 13px Arial';
  ctx.fillText('HR Nexus — Workflow Studio', 1160, 1690);
  return canvas;
}

function buildPdf(jpegs: Uint8Array[], widths: number[], heights: number[]) {
  // Each PDF object must be a single contiguous byte stream. The previous
  // implementation pushed dictionary/text/image fragments as separate PDF
  // objects, which produced a structurally invalid PDF that could appear blank.
  const objects: Uint8Array[] = [];
  const enc = new TextEncoder();
  const concat=(parts:Uint8Array[])=>{const n=parts.reduce((a,b)=>a+b.length,0);const out=new Uint8Array(n);let o=0;for(const part of parts){out.set(part,o);o+=part.length;}return out;};
  const header = enc.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  objects.push(enc.encode('<< /Type /Catalog /Pages 2 0 R >>'));
  const pageCount=jpegs.length;
  const kids=Array.from({length:pageCount},(_,i)=>`${3+i*3} 0 R`).join(' ');
  objects.push(enc.encode(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`));
  for(let i=0;i<pageCount;i++){
    const pageObj=3+i*3, contentObj=4+i*3, imageObj=5+i*3;
    void pageObj; void contentObj; void imageObj;
    objects.push(enc.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${i} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`));
    const content=enc.encode(`q\n595 0 0 842 0 0 cm\n/Im${i} Do\nQ\n`);
    objects.push(concat([enc.encode(`<< /Length ${content.length} >>\nstream\n`),content,enc.encode('\nendstream')]));
    const jpeg=jpegs[i];
    objects.push(concat([enc.encode(`<< /Type /XObject /Subtype /Image /Width ${widths[i]} /Height ${heights[i]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,enc.encode('\nendstream')]));
  }
  const chunks:Uint8Array[]=[header]; let pos=header.length; const offsets:number[]=[0];
  objects.forEach((obj,i)=>{const num=i+1;offsets[num]=pos;const a=enc.encode(`${num} 0 obj\n`),b=enc.encode('\nendobj\n');chunks.push(a,obj,b);pos+=a.length+obj.length+b.length;});
  const xrefPos=pos; let xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i++)xref+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  xref+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  chunks.push(enc.encode(xref));
  return concat(chunks);
}

export async function downloadWorkflowMapPdf(model: WorkflowPdfModel) {
  const perPage = 4;
  const total = Math.max(1, Math.ceil(model.stages.length / perPage));
  const pages = Array.from({ length: total }, (_, i) => makePage(model, i + 1, total));
  const images = pages.map(canvas => {
    const raw = atob(canvas.toDataURL('image/jpeg', 0.94).split(',')[1]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  });
  const pdf = buildPdf(images, pages.map(p => p.width), pages.map(p => p.height));
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `workflow-map-${Date.now()}.pdf`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
