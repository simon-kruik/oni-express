const AWS = require('aws-sdk');




let sendEmail = (data) => {
    const SES_CONFIG = {
        accessKeyId: data["access_key_id"],
        secretAccessKey: data["secret_access_key"],
        region: data["region"]
    }
    const AWS_SES = new AWS.SES(SES_CONFIG);


    let params = {
        Source: data['source_email'],
        Template: data['template'],
        Destination: {
            ToAddresses: data['dest_emails']
        },
        TemplateData: data['template_data']

    }
    return AWS_SES.sendTemplatedEmail(params).promise();
}

module.exports = sendEmail;