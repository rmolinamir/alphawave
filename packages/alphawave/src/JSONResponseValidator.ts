import { Validator, Schema, ValidationError } from "jsonschema";
import { PromptFunctions, PromptMemory, Tokenizer } from "promptrix";
import { PromptResponse, Validation, PromptResponseValidator } from "./types";
import { Response } from "./Response";

/**
 * Parses any JSON returned by the model and optionally verifies it against a JSON schema.
 * @template TContent Optional. Type of the content of the message. Defaults to `Record<string, any>`.
 */
export class JSONResponseValidator<TContent = Record<string, any>> implements PromptResponseValidator {

    /**
     * Creates a new `JSONResponseValidator` instance.
     * @param schema Optional. JSON schema to validate the response against.
     * @param missingJsonFeedback Optional. Custom feedback to give when no JSON is returned.
     * @param errorFeedback Optional. Custom feedback to give when an error is detected.
     */
    public constructor(schema?: Schema, missingJsonFeedback?: string, errorFeedback?: string, instanceName?: string) {
        this.schema = schema;
        this.missingJsonFeedback = missingJsonFeedback ?? 'No valid JSON objects were found in the response. Return a valid JSON object.';
        this.errorFeedback = errorFeedback ?? 'The JSON returned had errors. Apply these fixes:';
    }

    public readonly errorFeedback: string;
    public readonly instanceName?: string;
    public readonly missingJsonFeedback: string;
    public readonly schema?: Schema;

    /**
     * Validates the response.
     * @param memory Memory used to render the prompt.
     * @param functions Functions used to render the prompt.
     * @param tokenizer Tokenizer used to render the prompt.
     * @param response Response to validate.
     * @param remaining_attempts Number of remaining validation attempts.
     * @returns A `Validation` with the status and value.
     */
    public validateResponse(memory: PromptMemory, functions: PromptFunctions, tokenizer: Tokenizer, response: PromptResponse, remaining_attempts: number): Promise<Validation> {
        const message = response.message;
        const text = typeof message === 'string' ? message : message.content ?? '';

        // Parse the response text
        const parsed = Response.parseAllObjects(text);
        if (parsed.length == 0) {
            if (typeof message === 'object' && message.content === null)
                return Promise.resolve({
                    type: 'Validation',
                    valid: true,
                    value: null
                });
            else
                return Promise.resolve({
                    type: 'Validation',
                    valid: false,
                    feedback: this.missingJsonFeedback
                });
        }

        // Validate the response against the schema
        if (this.schema) {
            let errors: ValidationError[] | undefined;
            const validator = new Validator();
            for (let i = parsed.length - 1; i >= 0; i--) {
                const obj = Response.removeEmptyValuesFromObject(parsed[i]);
                const result = validator.validate(obj, this.schema);
                if (result.valid) {
                    return Promise.resolve({
                        type: 'Validation',
                        valid: true,
                        value: obj
                    });
                } else if (!errors) {
                    errors = result.errors
                }
            }

            return Promise.resolve({
                type: 'Validation',
                valid: false,
                feedback: `${this.errorFeedback}\n${errors!.map(e => this.getErrorFix(e)).join('\n')}`
            });
        } else {
            // Return the last object
            return Promise.resolve({
                type: 'Validation',
                valid: true,
                value: parsed[parsed.length - 1]
            });
        }
    }

    private getErrorFix(error: ValidationError): string {
        // Get argument as a string
        let arg: string;
        if (Array.isArray(error.argument)) {
            arg = error.argument.join(',');
        } else if (typeof error.argument === 'object') {
            arg = JSON.stringify(error.argument);
        } else {
            arg = error.argument.toString();
        }

        switch (error.name) {
            case 'type':
                // field is of the wrong type
                return `convert "${error.property}" to a ${arg}`;
            case 'anyOf':
                // field is not one of the allowed types
                return `convert "${error.property}" to one of the allowed types: ${arg}`;
            case 'additionalProperties':
                // field has an extra property
                return `remove the "${arg}" property from "${error.property}"`;
            case 'required':
                // field is missing a required property
                return `add the "${arg}" property to "${error.property}"`;
            case 'format':
                // field is not in the correct format
                return `change the "${error.property}" property to be a ${arg}`;
            case 'uniqueItems':
                // field has duplicate items
                return `remove all duplicate items from "${error.property}"`;
            case 'enum':
                // field is not one of the allowed values
                arg = error.message.split(':')[1].trim();
                return `change the "${error.property}" property to be one of these values: ${arg}`;
            case 'const':
                // field is not the correct value
                return `change the "${error.property}" property to be ${arg}`;
            default:
                return `"${error.property}" ${error.message}. Fix that`;
        }
    }
}
