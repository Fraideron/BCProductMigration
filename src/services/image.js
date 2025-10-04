// Image service - handles image upload operations
import axios from 'axios';
import FormData from 'form-data';
import mime from 'mime-types';
import { requestWithRetry } from '../api/client.js';

/**
 * Upload image with fallback to binary upload if URL method fails
 */
export async function uploadImageWithFallback(
  dstClient, 
  productId, 
  srcUrl, 
  { is_thumbnail = false, sort_order = 0, description = '' } = {}
) {
  // Try image_url method first
  try {
    const res = await requestWithRetry(dstClient, {
      method: 'post',
      url: `/catalog/products/${productId}/images`,
      data: { image_url: srcUrl, is_thumbnail, sort_order, description }
    });
    return { method: 'url', data: res.data?.data };
  } catch (err) {
    const status = err?.message?.match(/"status":(\d{3})/)?.[1] || '';
    console.log(`   ↪️ image_url failed (${status || 'err'}). Falling back to binary upload…`);
  }
  
  // Fallback to binary upload
  const filename = (() => {
    const urlPart = srcUrl.split('?')[0].split('/').pop() || 'image';
    const extByMime = (ct) => (mime.extension(ct) ? `.${mime.extension(ct)}` : '');
    return urlPart.includes('.') ? urlPart : urlPart + extByMime('image/jpeg');
  })();
  
  const imgResp = await requestWithRetry(axios, { 
    method: 'get', 
    url: srcUrl, 
    responseType: 'arraybuffer' 
  });
  
  const buf = Buffer.from(imgResp.data);
  const contentType = imgResp.headers?.['content-type'] || 'application/octet-stream';
  
  const form = new FormData();
  form.append('image_file', buf, { filename, contentType });
  form.append('is_thumbnail', String(is_thumbnail));
  form.append('sort_order', String(sort_order));
  if (description) form.append('description', description);
  
  const res2 = await requestWithRetry(dstClient, {
    method: 'post',
    url: `/catalog/products/${productId}/images`,
    headers: form.getHeaders(),
    data: form
  });
  
  return { method: 'file', data: res2.data?.data };
}
