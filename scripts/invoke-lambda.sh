# AWS Lambda Invocation Script
echo "Invoking Lambda function: VitkuzServerlessAuroraTes-DBLambdaFunctionE691E1BE-L30kChSIeQ4z"

aws lambda invoke \
    --function-name "VitkuzServerlessAuroraTes-DBLambdaFunctionE691E1BE-L30kChSIeQ4z" \
    --payload '{}' \
    response.json

echo "Lambda function response:"
cat response.json
