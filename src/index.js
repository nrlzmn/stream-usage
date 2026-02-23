/**
 * Cloudflare Stream Usage Notification Worker
 * 
 * Runs daily to fetch Stream storage usage and sends email notification via Resend.
 * 
 * Required environment variables (secrets):
 * - CF_API_TOKEN: Cloudflare API token with Stream Read permission
 * - CF_ACCOUNT_ID: Cloudflare account ID
 * - RESEND_API_KEY: Resend API key
 * - NOTIFICATION_EMAIL: Email address to send notifications to
 * - FROM_EMAIL: Sender email (must be verified in Resend, e.g., "Stream Usage <notifications@yourdomain.com>"). Using: onboarding@resend.dev for now
 */

async function fetchStreamUsage(accountId, apiToken) {
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/storage-usage`,
		{
			headers: {
				'Authorization': `Bearer ${apiToken}`,
				'Content-Type': 'application/json',
			},
		}
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch Stream usage: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	
	if (!data.success) {
		throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
	}

	return data.result;
}

async function sendEmailNotification(env, usageData) {
	const { totalStorageMinutes, totalStorageMinutesLimit, videoCount } = usageData;
	
	const usagePercent = totalStorageMinutesLimit > 0 
		? ((totalStorageMinutes / totalStorageMinutesLimit) * 100).toFixed(2)
		: 'N/A';

	const formattedMinutes = totalStorageMinutes.toLocaleString();
	const formattedLimit = totalStorageMinutesLimit.toLocaleString();

	const emailHtml = `
		<!DOCTYPE html>
		<html>
		<head>
			<style>
				body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
				.container { max-width: 600px; margin: 0 auto; padding: 20px; }
				.header { background: linear-gradient(135deg, #f6821f 0%, #faad3f 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
				.content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
				.stat-card { background: white; border-radius: 8px; padding: 15px; margin: 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
				.stat-value { font-size: 24px; font-weight: bold; color: #f6821f; }
				.stat-label { color: #666; font-size: 14px; }
				.progress-bar { background: #e0e0e0; border-radius: 10px; height: 20px; overflow: hidden; margin-top: 10px; }
				.progress-fill { background: linear-gradient(90deg, #f6821f, #faad3f); height: 100%; transition: width 0.3s; }
				.footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="header">
					<h1 style="margin: 0;">📊 Cloudflare Stream Usage Report</h1>
					<p style="margin: 5px 0 0 0; opacity: 0.9;">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
				</div>
				<div class="content">
					<div class="stat-card">
						<div class="stat-label">Storage Used</div>
						<div class="stat-value">${formattedMinutes} minutes</div>
						<div class="progress-bar">
							<div class="progress-fill" style="width: ${Math.min(parseFloat(usagePercent) || 0, 100)}%"></div>
						</div>
						<div style="margin-top: 5px; font-size: 12px; color: #666;">
							${usagePercent}% of ${formattedLimit} minutes limit
						</div>
					</div>
					
					<div class="stat-card">
						<div class="stat-label">Total Videos</div>
						<div class="stat-value">${videoCount.toLocaleString()}</div>
					</div>

					${parseFloat(usagePercent) >= 80 ? `
					<div class="stat-card" style="border-left: 4px solid #ff4444;">
						<strong style="color: #ff4444;">⚠️ Warning:</strong> You are using ${usagePercent}% of your storage limit. Consider upgrading your plan or removing unused videos.
					</div>
					` : ''}
				</div>
				<div class="footer">
					<p>This is an automated notification from your Cloudflare Stream Usage Worker.</p>
				</div>
			</div>
		</body>
		</html>
	`;

	const payload = {
		from: env.FROM_EMAIL,
		to: [env.NOTIFICATION_EMAIL],
		subject: `Cloudflare Stream Usage Report - ${usagePercent}% used`,
		html: emailHtml,
	};

	console.log('Sending email with payload:', JSON.stringify({ ...payload, html: '[truncated]' }));

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${env.RESEND_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	const responseText = await response.text();
	console.log('Resend API response:', response.status, responseText);

	if (!response.ok) {
		throw new Error(`Failed to send email via Resend: ${response.status} - ${responseText}`);
	}

	return JSON.parse(responseText);
}

export default {
	async scheduled(event, env, ctx) {
		console.log('Running scheduled Stream usage notification...');
		
		try {
			const usageData = await fetchStreamUsage(env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
			console.log('Stream usage data:', JSON.stringify(usageData));
			
			const emailResult = await sendEmailNotification(env, usageData);
			console.log('Email sent successfully:', JSON.stringify(emailResult));
			
			return { success: true, usage: usageData, emailId: emailResult.id };
		} catch (error) {
			console.error('Error in scheduled job:', error.message);
			throw error;
		}
	},

	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		
		if (url.pathname === '/test') {
			try {
				const usageData = await fetchStreamUsage(env.CF_ACCOUNT_ID, env.CF_API_TOKEN);
				const emailResult = await sendEmailNotification(env, usageData);
				
				return new Response(JSON.stringify({
					success: true,
					message: 'Test email sent successfully',
					usage: usageData,
					emailId: emailResult.id,
				}, null, 2), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error) {
				return new Response(JSON.stringify({
					success: false,
					error: error.message,
				}, null, 2), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		return new Response(JSON.stringify({
			name: 'Cloudflare Stream Usage Notification Worker',
			endpoints: {
				'/test': 'Trigger a test email notification',
			},
			schedule: 'Daily at midnight UTC',
		}, null, 2), {
			headers: { 'Content-Type': 'application/json' },
		});
	},
};
