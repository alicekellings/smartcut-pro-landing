import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // 只允许 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { licenseKey } = req.body;

  if (!licenseKey) {
    return res
      .status(400)
      .json({ valid: false, message: 'Missing license key' });
  }

  // 从环境变量获取 Payhip API Key (在 Vercel 后台设置)
  const { PAYHIP_API_KEY } = process.env;

  if (!PAYHIP_API_KEY) {
    console.error(
      'SERVER ERROR: Payhip API Key not set in environment variables.',
    );
    return res
      .status(500)
      .json({ valid: false, message: 'Server configuration error' });
  }

  try {
    // 调用 Payhip 官方验证接口
    // 文档: https://payhip.com/api-docs#verify-license
    // 强制使用已验证的 Product ID
    const productKey = 'sta2v';

    const apiUrl = `https://payhip.com/api/v1/license/verify?product_link=${encodeURIComponent(
      productKey,
    )}&license_key=${encodeURIComponent(licenseKey)}`;

    const payhipRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'payhip-api-key': PAYHIP_API_KEY,
        'User-Agent': 'SmartCutPro-Verifier/1.0',
      },
    });

    const data = await payhipRes.json();

    // 关键修正: 无论成功失败，都把 Payhip 的原始返回打印出来，方便调试
    console.log('Payhip Response:', JSON.stringify(data));

    if (payhipRes.status === 200 && data.success) {
      return res.status(200).json({
        valid: true,
        licenseMsg: 'License is active',
        email: data.data.customer_email,
      });
    }

    // 验证失败时，返回 Payhip 的原始错误信息
    return res.status(200).json({
      valid: false,
      licenseMsg: data.message || 'License not found or invalid', // 透传 Payhip 的 message
      payhipDebug: data, // 把整个数据吐出来给我看
    });
  } catch (error) {
    console.error('Verify Error:', error);
    return res
      .status(500)
      .json({ valid: false, message: 'Verification failed' });
  }
}
