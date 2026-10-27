/**
 * Google Apps Script Web App - Code.gs
 * Copy and paste this directly into https://script.google.com
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = lock.tryLock(10000);

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({
        success: false,
        error: 'Bad Request: Missing request body'
      }, 400);
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({
        success: false,
        error: 'Bad Request: Malformed JSON payload'
      }, 400);
    }

    // 1. Verify Shared Secret Authentication
    var configuredSecret = PropertiesService.getScriptProperties().getProperty('HEIMDALL_SHARED_SECRET');
    if (!configuredSecret) {
      return createJsonResponse({
        success: false,
        error: 'Configuration Error: HEIMDALL_SHARED_SECRET is not set in Script Properties'
      }, 500);
    }

    var providedSecret = payload.authSecret || (e.parameter && e.parameter.authSecret);
    if (!providedSecret || providedSecret !== configuredSecret) {
      return createJsonResponse({
        success: false,
        error: 'Unauthorized: Invalid or missing authentication secret'
      }, 401);
    }

    // 2. Validate Required Fields
    var recipient = payload.recipientEmail || payload.to;
    var subject = payload.subject;
    var htmlBody = payload.htmlBody || payload.html;
    var textBody = payload.textBody || payload.text;
    var requestId = payload.requestId || 'req-' + Utilities.getUuid();

    if (!recipient || typeof recipient !== 'string') {
      return createJsonResponse({
        success: false,
        error: 'Validation Error: Recipient email is required'
      }, 400);
    }

    recipient = recipient.trim().toLowerCase();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipient)) {
      return createJsonResponse({
        success: false,
        error: 'Validation Error: Invalid recipient email address format'
      }, 400);
    }

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return createJsonResponse({
        success: false,
        error: 'Validation Error: Email subject is required'
      }, 400);
    }

    if (!htmlBody && !textBody) {
      return createJsonResponse({
        success: false,
        error: 'Validation Error: Email content (htmlBody or textBody) is required'
      }, 400);
    }

    // 3. Check Daily Quota
    var remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota <= 0) {
      return createJsonResponse({
        success: false,
        error: 'Quota Exhausted: Google daily email quota has been exhausted. Retry tomorrow or switch to Google Workspace.',
        quotaRemaining: 0
      }, 429);
    }

    // 4. Send Email via Google MailApp
    var mailOptions = {
      to: recipient,
      subject: subject.trim(),
      name: 'HEIMDALL Hostel Management'
    };

    if (htmlBody) {
      mailOptions.htmlBody = htmlBody;
      mailOptions.body = textBody || htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      mailOptions.body = textBody;
    }

    MailApp.sendEmail(mailOptions);

    var newQuota = MailApp.getRemainingDailyQuota();
    var messageId = 'gas-' + Utilities.getUuid();

    return createJsonResponse({
      success: true,
      status: 'SUBMITTED',
      messageId: messageId,
      requestId: requestId,
      recipient: recipient,
      quotaRemaining: newQuota,
      timestamp: new Date().toISOString()
    }, 200);

  } catch (err) {
    return createJsonResponse({
      success: false,
      error: 'Delivery Error: ' + err.toString(),
      quotaRemaining: MailApp.getRemainingDailyQuota()
    }, 500);
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

function doGet(e) {
  try {
    var quota = MailApp.getRemainingDailyQuota();
    return createJsonResponse({
      status: 'OK',
      service: 'HEIMDALL Google Apps Script Email Relay',
      version: '1.0.0',
      freeQuotaRemaining: quota,
      timestamp: new Date().toISOString()
    }, 200);
  } catch (err) {
    return createJsonResponse({
      status: 'ERROR',
      error: err.toString()
    }, 500);
  }
}

function createJsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
