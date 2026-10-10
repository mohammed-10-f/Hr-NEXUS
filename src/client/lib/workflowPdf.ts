export type WorkflowPdfModel = {
  name: string;
  description?: string | null;
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

function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3) {
  const words = String(text || '').split(/\s+/);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines++;
      line = word;
      if (lines >= maxLines - 1) break;
    } else line = test;
  }
  if (lines < maxLines && line) {
    ctx.fillText(line, x, y + lines * lineHeight);
    lines++;
  }
  return lines;
}

function makePage(model: WorkflowPdfModel, page: number, total: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1240; canvas.height = 1754;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.direction = 'rtl'; ctx.textAlign = 'right';
  let y = 100;
  ctx.fillStyle = '#172033'; ctx.font = '700 34px Arial';
  ctx.fillText(model.name, 1160, y);
  y += 50;
  ctx.fillStyle = '#667085'; ctx.font = '400 18px Arial';
  drawWrapped(ctx, model.description || 'خارطة سير العمل', 1160, y, 1020, 28, 2);
  y += 75;
  ctx.strokeStyle = '#d9dee8'; ctx.beginPath(); ctx.moveTo(80,y); ctx.lineTo(1160,y); ctx.stroke();
  y += 45;
  ctx.fillStyle = '#334155'; ctx.font = '700 21px Arial';
  ctx.fillText(`المراحل — صفحة ${page} من ${total}`, 1160, y);
  y += 35;

  const perPage = 5;
  const start = (page-1)*perPage;
  const pageStages = model.stages.slice(start,start+perPage);
  pageStages.forEach((s, local) => {
    const h = 190;
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(80,y,1080,h);
    ctx.strokeStyle = '#d9dee8'; ctx.strokeRect(80,y,1080,h);
    ctx.fillStyle = '#2563eb'; ctx.font = '700 24px Arial';
    ctx.fillText(`المرحلة ${start+local+1}`, 1120, y+40);
    ctx.fillStyle = '#172033'; ctx.font = '700 24px Arial';
    ctx.fillText(s.name, 1120, y+78);
    ctx.fillStyle = '#667085'; ctx.font = '400 17px Arial';
    ctx.fillText(`المسؤول: ${s.responsible || 'غير محدد'}${s.duration ? ` — المدة: ${s.duration} دقيقة` : ''}`, 1120, y+112);
    ctx.fillStyle = '#334155'; ctx.font = '600 17px Arial';
    ctx.fillText('العناصر:', 1120, y+145);
    ctx.font = '400 16px Arial';
    const fields = s.fields.length ? s.fields.join('، ') : 'لا توجد عناصر';
    drawWrapped(ctx, fields, 1020, y+145, 760, 23, 2);
    y += h + 24;
  });

  const relevant = model.routes.filter(r => pageStages.some(s=>s.name===r.from));
  if(relevant.length && y < 1450) {
    ctx.fillStyle = '#334155'; ctx.font = '700 20px Arial';
    ctx.fillText('الشروط والمسارات',1160,y+10); y+=45;
    ctx.font = '400 16px Arial';
    relevant.slice(0,5).forEach(r=>{
      const line = `${r.from} — ${r.condition || 'بدون شرط'} → ${r.target || r.action} (${r.label})`;
      drawWrapped(ctx,line,1120,y,1000,24,2); y+=48;
    });
  }
  ctx.fillStyle = '#98a2b3'; ctx.font='400 14px Arial';
  ctx.fillText('HR Nexus — Workflow Studio',1160,1680);
  return canvas;
}

function escPdfBytes(bytes: Uint8Array) {
  return bytes;
}

function buildPdf(jpegs: Uint8Array[], widths: number[], heights: number[]) {
  const objects: Uint8Array[] = [];
  const enc = new TextEncoder();
  const header = enc.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  const offsets: number[] = [0];
  const push = (s: string | Uint8Array) => objects.push(typeof s === 'string' ? enc.encode(s) : s);
  push('<< /Type /Catalog /Pages 2 0 R >>');
  const pageCount = jpegs.length;
  const pagesKids = Array.from({length:pageCount},(_,i)=>`${3+i*3} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${pagesKids}] /Count ${pageCount} >>`);
  for(let i=0;i<pageCount;i++){
    const pageObj=3+i*3, contentObj=4+i*3, imageObj=5+i*3;
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${i} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    const content=enc.encode(`q\n595 0 0 842 0 0 cm\n/Im${i} Do\nQ\n`);
    push(`<< /Length ${content.length} >>\nstream\n`);
    objects.push(content); push('\nendstream');
    const jpeg=jpegs[i];
    const dict=enc.encode(`<< /Type /XObject /Subtype /Image /Width ${widths[i]} /Height ${heights[i]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    objects.push(dict); objects.push(jpeg); push('\nendstream');
  }
  const chunks: Uint8Array[]=[header];
  let pos=header.length;
  objects.forEach((obj,i)=>{
    const num=i+1;
    offsets[num]=pos;
    const open=enc.encode(`${num} 0 obj\n`);
    const close=enc.encode('\nendobj\n');
    chunks.push(open,obj,close); pos+=open.length+obj.length+close.length;
  });
  const xrefPos=pos;
  let xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=objects.length;i++) xref+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  xref+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  chunks.push(enc.encode(xref));
  const total=chunks.reduce((n,c)=>n+c.length,0); const out=new Uint8Array(total); let at=0;
  chunks.forEach(c=>{out.set(c,at);at+=c.length;});
  return out;
}

export async function downloadWorkflowMapPdf(model: WorkflowPdfModel) {
  const perPage=5;
  const total=Math.max(1,Math.ceil(model.stages.length/perPage));
  const pages=Array.from({length:total},(_,i)=>makePage(model,i+1,total));
  const images=pages.map(c=>new Uint8Array(atob(c.toDataURL('image/jpeg',0.9).split(',')[1]).split('').map(ch=>ch.charCodeAt(0))));
  const pdf=buildPdf(images,pages.map(p=>p.width),pages.map(p=>p.height));
  const blob=new Blob([pdf],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`workflow-map-${Date.now()}.pdf`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
