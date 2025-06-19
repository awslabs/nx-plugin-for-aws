/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  toClassName,
  toKebabCase,
  toSnakeCase,
  toDotNotation,
  kebabCase,
  snakeCase,
} from './names';

describe('names utils', () => {
  describe('toClassName', () => {
    it('should convert basic strings to PascalCase', () => {
      expect(toClassName('hello world')).toBe('HelloWorld');
      expect(toClassName('my-component')).toBe('MyComponent');
      expect(toClassName('user_profile')).toBe('UserProfile');
    });

    it('should handle strings starting with numbers', () => {
      expect(toClassName('123hello')).toBe('_123hello');
      expect(toClassName('1st-place')).toBe('_1stPlace');
    });

    it('should handle empty or undefined input', () => {
      expect(toClassName('')).toBe('');
      expect(toClassName(undefined)).toBe(undefined);
    });

    it('should handle multiple consecutive separators', () => {
      expect(toClassName('hello__world')).toBe('HelloWorld');
      expect(toClassName('hello--world')).toBe('HelloWorld');
      expect(toClassName('hello  world')).toBe('HelloWorld');
    });
  });

  describe('toKebabCase', () => {
    it('should convert basic strings to kebab-case', () => {
      expect(toKebabCase('HelloWorld')).toBe('hello-world');
      expect(toKebabCase('myComponent')).toBe('my-component');
      expect(toKebabCase('UserProfile')).toBe('user-profile');
    });

    it('should preserve path separators', () => {
      expect(toKebabCase('src/components/UserProfile')).toBe(
        'src/components/user-profile',
      );
      expect(toKebabCase('pages/HomePage/index')).toBe('pages/home-page/index');
    });

    it('should handle empty or undefined input', () => {
      expect(toKebabCase('')).toBe('');
      expect(toKebabCase(undefined)).toBe(undefined);
    });

    it('should handle multiple consecutive separators', () => {
      expect(toKebabCase('hello__world')).toBe('hello-world');
      expect(toKebabCase('hello--world')).toBe('hello-world');
      expect(toKebabCase('hello  world')).toBe('hello-world');
    });

    it('should handle numbers in names correctly', () => {
      expect(toKebabCase('version2Api')).toBe('version2-api');
      expect(toKebabCase('api3Handler')).toBe('api3-handler');
      expect(toKebabCase('user123Profile')).toBe('user123-profile');
      expect(toKebabCase('test42Component')).toBe('test42-component');
      expect(toKebabCase('v2')).toBe('v2');
      expect(toKebabCase('e2e')).toBe('e2e');
    });

    it('should handle multiple numbers in names', () => {
      expect(toKebabCase('version2Api3Handler')).toBe('version2-api3-handler');
      expect(toKebabCase('test123Component456')).toBe('test123-component456');
      expect(toKebabCase('api1Version2Handler3')).toBe(
        'api1-version2-handler3',
      );
    });

    it('should handle names starting or ending with numbers', () => {
      expect(toKebabCase('2ndGeneration')).toBe('2nd-generation');
      expect(toKebabCase('generation2')).toBe('generation2');
      expect(toKebabCase('3rdPartyApi')).toBe('3rd-party-api');
    });
  });

  describe('toSnakeCase', () => {
    it('should convert basic strings to snake_case', () => {
      expect(toSnakeCase('HelloWorld')).toBe('hello_world');
      expect(toSnakeCase('myComponent')).toBe('my_component');
      expect(toSnakeCase('UserProfile')).toBe('user_profile');
    });

    it('should preserve path separators', () => {
      expect(toSnakeCase('src/components/UserProfile')).toBe(
        'src/components/user_profile',
      );
      expect(toSnakeCase('pages/HomePage/index')).toBe('pages/home_page/index');
    });

    it('should handle empty or undefined input', () => {
      expect(toSnakeCase('')).toBe('');
      expect(toSnakeCase(undefined)).toBe(undefined);
    });

    it('should handle multiple consecutive separators', () => {
      expect(toSnakeCase('hello__world')).toBe('hello_world');
      expect(toSnakeCase('hello--world')).toBe('hello_world');
      expect(toSnakeCase('hello  world')).toBe('hello_world');
    });

    it('should handle numbers in names correctly', () => {
      expect(toSnakeCase('version2Api')).toBe('version2_api');
      expect(toSnakeCase('api3Handler')).toBe('api3_handler');
      expect(toSnakeCase('user123Profile')).toBe('user123_profile');
      expect(toSnakeCase('test42Component')).toBe('test42_component');
    });

    it('should handle multiple numbers in names', () => {
      expect(toSnakeCase('version2Api3Handler')).toBe('version2_api3_handler');
      expect(toSnakeCase('test123Component456')).toBe('test123_component456');
      expect(toSnakeCase('api1Version2Handler3')).toBe(
        'api1_version2_handler3',
      );
    });

    it('should handle names starting or ending with numbers', () => {
      expect(toSnakeCase('2ndGeneration')).toBe('2nd_generation');
      expect(toSnakeCase('generation2')).toBe('generation2');
      expect(toSnakeCase('3rdPartyApi')).toBe('3rd_party_api');
    });
  });

  describe('toDotNotation', () => {
    it('should convert a string to a dot notation string', () => {
      expect(toDotNotation('lambda_handler/my_handler')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle empty or undefined input', () => {
      expect(toDotNotation('')).toBe('');
      expect(toDotNotation(undefined)).toBe(undefined);
    });

    it('should handle multiple consecutive separators', () => {
      expect(toDotNotation('lambda_handler//my_handler')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle .py extension', () => {
      expect(toDotNotation('lambda_handler/my_handler.py')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle leading and trailing slashes', () => {
      expect(toDotNotation('/lambda_handler/my_handler/')).toBe(
        'lambda_handler.my_handler',
      );
    });

    it('should handle any file extensions', () => {
      expect(toDotNotation('lambda_handler/my_handler.ts')).toBe(
        'lambda_handler.my_handler',
      );

      expect(toDotNotation('lambda_handler/my_handler.toml')).toBe(
        'lambda_handler.my_handler',
      );

      expect(toDotNotation('lambda_handler/my_handler.json')).toBe(
        'lambda_handler.my_handler',
      );

      expect(toDotNotation('lambda_handler/my_handler.yaml')).toBe(
        'lambda_handler.my_handler',
      );
    });
  });

  describe('snakeCase (direct function)', () => {
    describe('basic functionality', () => {
      it('should convert camelCase to snake_case', () => {
        expect(snakeCase('camelCase')).toBe('camel_case');
        expect(snakeCase('myVariableName')).toBe('my_variable_name');
        expect(snakeCase('getUserProfile')).toBe('get_user_profile');
      });

      it('should convert PascalCase to snake_case', () => {
        expect(snakeCase('PascalCase')).toBe('pascal_case');
        expect(snakeCase('MyClassName')).toBe('my_class_name');
        expect(snakeCase('UserProfileComponent')).toBe(
          'user_profile_component',
        );
      });

      it('should handle kebab-case input', () => {
        expect(snakeCase('kebab-case')).toBe('kebab_case');
        expect(snakeCase('my-variable-name')).toBe('my_variable_name');
        expect(snakeCase('user-profile-component')).toBe(
          'user_profile_component',
        );
      });

      it('should handle mixed separators', () => {
        expect(snakeCase('mixed_case-string')).toBe('mixed_case_string');
        expect(snakeCase('some.dot.notation')).toBe('some_dot_notation');
        expect(snakeCase('spaces and underscores_here')).toBe(
          'spaces_and_underscores_here',
        );
      });

      it('should handle already snake_case strings', () => {
        expect(snakeCase('already_snake_case')).toBe('already_snake_case');
        expect(snakeCase('my_variable_name')).toBe('my_variable_name');
      });
    });

    describe('number spacing preservation', () => {
      it('should preserve number spacing from kebab-case', () => {
        expect(snakeCase('foo-3-bar')).toBe('foo_3_bar');
        expect(snakeCase('api-v2-handler')).toBe('api_v2_handler');
        expect(snakeCase('test-123-component')).toBe('test_123_component');
      });

      it('should preserve number spacing from camelCase/PascalCase', () => {
        expect(snakeCase('Foo3Bar')).toBe('foo3_bar');
        expect(snakeCase('version2Api')).toBe('version2_api');
        expect(snakeCase('test42Component')).toBe('test42_component');
        expect(snakeCase('Api3Handler')).toBe('api3_handler');
      });

      it('should handle multiple numbers with separators', () => {
        expect(snakeCase('foo-3-bar-5-baz')).toBe('foo_3_bar_5_baz');
        expect(snakeCase('api-v2-test-123-handler')).toBe(
          'api_v2_test_123_handler',
        );
        expect(snakeCase('component-1-version-2-build-3')).toBe(
          'component_1_version_2_build_3',
        );
      });

      it('should handle numbers at start and end', () => {
        expect(snakeCase('2ndGeneration')).toBe('2nd_generation');
        expect(snakeCase('3rd-party-api')).toBe('3rd_party_api');
        expect(snakeCase('generation2')).toBe('generation2');
        expect(snakeCase('api-version-3')).toBe('api_version_3');
      });

      it('should handle consecutive numbers', () => {
        expect(snakeCase('version23Api')).toBe('version23_api');
        expect(snakeCase('test-123-456-component')).toBe(
          'test_123_456_component',
        );
        expect(snakeCase('api1Version2Handler3')).toBe(
          'api1_version2_handler3',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty strings', () => {
        expect(snakeCase('')).toBe('');
      });

      it('should handle single characters', () => {
        expect(snakeCase('a')).toBe('a');
        expect(snakeCase('A')).toBe('a');
        expect(snakeCase('1')).toBe('1');
      });

      it('should handle special characters', () => {
        expect(snakeCase('hello@world')).toBe('hello_world');
        expect(snakeCase('test#component')).toBe('test_component');
        expect(snakeCase('api$handler')).toBe('api_handler');
        expect(snakeCase('user%profile')).toBe('user_profile');
      });

      it('should handle multiple consecutive separators', () => {
        expect(snakeCase('hello---world')).toBe('hello_world');
        expect(snakeCase('test___component')).toBe('test_component');
        expect(snakeCase('api   handler')).toBe('api_handler');
      });

      it('should handle leading and trailing separators', () => {
        expect(snakeCase('-hello-world-')).toBe('hello_world');
        expect(snakeCase('_test_component_')).toBe('test_component');
        expect(snakeCase(' api handler ')).toBe('api_handler');
      });
    });

    describe('acronym handling', () => {
      it('should handle common acronyms correctly', () => {
        expect(snakeCase('XMLHttpRequest')).toBe('xmlhttp_request');
        expect(snakeCase('HTMLParser')).toBe('htmlparser');
        expect(snakeCase('JSONData')).toBe('jsondata');
        expect(snakeCase('APIKey')).toBe('apikey');
        expect(snakeCase('URLPath')).toBe('urlpath');
        expect(snakeCase('HTTPSConnection')).toBe('httpsconnection');
      });

      it('should handle mixed acronyms and words', () => {
        expect(snakeCase('parseXMLDocument')).toBe('parse_xmldocument');
        expect(snakeCase('createHTTPClient')).toBe('create_httpclient');
        expect(snakeCase('validateJSONSchema')).toBe('validate_jsonschema');
        expect(snakeCase('buildAPIResponse')).toBe('build_apiresponse');
      });

      it('should handle acronyms at the end', () => {
        expect(snakeCase('documentXML')).toBe('document_xml');
        expect(snakeCase('clientHTTP')).toBe('client_http');
        expect(snakeCase('schemaJSON')).toBe('schema_json');
        expect(snakeCase('responseAPI')).toBe('response_api');
      });
    });

    describe('unicode and international characters', () => {
      it('should handle unicode characters', () => {
        expect(snakeCase('héllo-wörld')).toBe('hello_world');
        expect(snakeCase('naïve-approach')).toBe('naive_approach');
        expect(snakeCase('café-menu')).toBe('cafe_menu');
      });

      it('should handle emoji and special unicode', () => {
        expect(snakeCase('hello🌍world')).toBe('hello_world');
        expect(snakeCase('test✨component')).toBe('test_component');
        expect(snakeCase('api🚀handler')).toBe('api_handler');
      });
    });

    describe('consistency and idempotency', () => {
      it('should be idempotent', () => {
        const testCases = [
          'camelCase',
          'PascalCase',
          'kebab-case',
          'already_snake_case',
          'mixed_case-string',
          'XMLHttpRequest',
          'api2Version',
          '2ndGeneration',
        ];

        testCases.forEach((testCase) => {
          const firstConversion = snakeCase(testCase);
          const secondConversion = snakeCase(firstConversion);
          expect(firstConversion).toBe(secondConversion);
        });
      });
    });

    describe('real-world examples', () => {
      it('should handle common programming terms', () => {
        expect(snakeCase('getUserById')).toBe('get_user_by_id');
        expect(snakeCase('createNewAccount')).toBe('create_new_account');
        expect(snakeCase('validateEmailAddress')).toBe(
          'validate_email_address',
        );
        expect(snakeCase('parseJSONResponse')).toBe('parse_jsonresponse');
        expect(snakeCase('buildHTMLElement')).toBe('build_htmlelement');
      });

      it('should handle AWS service names', () => {
        expect(snakeCase('S3Bucket')).toBe('s3_bucket');
        expect(snakeCase('EC2Instance')).toBe('ec2_instance');
        expect(snakeCase('RDSDatabase')).toBe('rdsdatabase');
        expect(snakeCase('LambdaFunction')).toBe('lambda_function');
        expect(snakeCase('CloudFormationStack')).toBe('cloud_formation_stack');
      });

      it('should handle file and path names', () => {
        expect(snakeCase('myComponent.tsx')).toBe('my_component_tsx');
        expect(snakeCase('userService.test.ts')).toBe('user_service_test_ts');
        expect(snakeCase('api-routes.config.js')).toBe('api_routes_config_js');
      });
    });
  });

  describe('kebabCase (direct function)', () => {
    describe('basic functionality', () => {
      it('should convert camelCase to kebab-case', () => {
        expect(kebabCase('camelCase')).toBe('camel-case');
        expect(kebabCase('myVariableName')).toBe('my-variable-name');
        expect(kebabCase('getUserProfile')).toBe('get-user-profile');
      });

      it('should convert PascalCase to kebab-case', () => {
        expect(kebabCase('PascalCase')).toBe('pascal-case');
        expect(kebabCase('MyClassName')).toBe('my-class-name');
        expect(kebabCase('UserProfileComponent')).toBe(
          'user-profile-component',
        );
      });

      it('should handle snake_case input', () => {
        expect(kebabCase('snake_case')).toBe('snake-case');
        expect(kebabCase('my_variable_name')).toBe('my-variable-name');
        expect(kebabCase('user_profile_component')).toBe(
          'user-profile-component',
        );
      });

      it('should handle mixed separators', () => {
        expect(kebabCase('mixed_case-string')).toBe('mixed-case-string');
        expect(kebabCase('some.dot.notation')).toBe('some-dot-notation');
        expect(kebabCase('spaces and hyphens-here')).toBe(
          'spaces-and-hyphens-here',
        );
      });

      it('should handle already kebab-case strings', () => {
        expect(kebabCase('already-kebab-case')).toBe('already-kebab-case');
        expect(kebabCase('my-variable-name')).toBe('my-variable-name');
      });
    });

    describe('number spacing preservation', () => {
      it('should preserve number spacing from snake_case', () => {
        expect(kebabCase('foo_3_bar')).toBe('foo-3-bar');
        expect(kebabCase('api_v2_handler')).toBe('api-v2-handler');
        expect(kebabCase('test_123_component')).toBe('test-123-component');
      });

      it('should preserve number spacing from camelCase/PascalCase', () => {
        expect(kebabCase('Foo3Bar')).toBe('foo3-bar');
        expect(kebabCase('version2Api')).toBe('version2-api');
        expect(kebabCase('test42Component')).toBe('test42-component');
        expect(kebabCase('Api3Handler')).toBe('api3-handler');
      });

      it('should handle multiple numbers with separators', () => {
        expect(kebabCase('foo_3_bar_5_baz')).toBe('foo-3-bar-5-baz');
        expect(kebabCase('api_v2_test_123_handler')).toBe(
          'api-v2-test-123-handler',
        );
        expect(kebabCase('component_1_version_2_build_3')).toBe(
          'component-1-version-2-build-3',
        );
      });

      it('should handle numbers at start and end', () => {
        expect(kebabCase('2ndGeneration')).toBe('2nd-generation');
        expect(kebabCase('3rd_party_api')).toBe('3rd-party-api');
        expect(kebabCase('generation2')).toBe('generation2');
        expect(kebabCase('api_version_3')).toBe('api-version-3');
      });

      it('should handle consecutive numbers', () => {
        expect(kebabCase('version23Api')).toBe('version23-api');
        expect(kebabCase('test_123_456_component')).toBe(
          'test-123-456-component',
        );
        expect(kebabCase('api1Version2Handler3')).toBe(
          'api1-version2-handler3',
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty strings', () => {
        expect(kebabCase('')).toBe('');
      });

      it('should handle single characters', () => {
        expect(kebabCase('a')).toBe('a');
        expect(kebabCase('A')).toBe('a');
        expect(kebabCase('1')).toBe('1');
      });

      it('should handle special characters', () => {
        expect(kebabCase('hello@world')).toBe('hello-world');
        expect(kebabCase('test#component')).toBe('test-component');
        expect(kebabCase('api$handler')).toBe('api-handler');
        expect(kebabCase('user%profile')).toBe('user-profile');
      });

      it('should handle multiple consecutive separators', () => {
        expect(kebabCase('hello___world')).toBe('hello-world');
        expect(kebabCase('test---component')).toBe('test-component');
        expect(kebabCase('api   handler')).toBe('api-handler');
      });

      it('should handle leading and trailing separators', () => {
        expect(kebabCase('_hello_world_')).toBe('hello-world');
        expect(kebabCase('-test-component-')).toBe('test-component');
        expect(kebabCase(' api handler ')).toBe('api-handler');
      });
    });

    describe('acronym handling', () => {
      it('should handle common acronyms correctly', () => {
        expect(kebabCase('XMLHttpRequest')).toBe('xmlhttp-request');
        expect(kebabCase('HTMLParser')).toBe('htmlparser');
        expect(kebabCase('JSONData')).toBe('jsondata');
        expect(kebabCase('APIKey')).toBe('apikey');
        expect(kebabCase('URLPath')).toBe('urlpath');
        expect(kebabCase('HTTPSConnection')).toBe('httpsconnection');
      });

      it('should handle mixed acronyms and words', () => {
        expect(kebabCase('parseXMLDocument')).toBe('parse-xmldocument');
        expect(kebabCase('createHTTPClient')).toBe('create-httpclient');
        expect(kebabCase('validateJSONSchema')).toBe('validate-jsonschema');
        expect(kebabCase('buildAPIResponse')).toBe('build-apiresponse');
      });

      it('should handle acronyms at the end', () => {
        expect(kebabCase('documentXML')).toBe('document-xml');
        expect(kebabCase('clientHTTP')).toBe('client-http');
        expect(kebabCase('schemaJSON')).toBe('schema-json');
        expect(kebabCase('responseAPI')).toBe('response-api');
      });
    });

    describe('unicode and international characters', () => {
      it('should handle unicode characters', () => {
        expect(kebabCase('héllo_wörld')).toBe('hello-world');
        expect(kebabCase('naïve_approach')).toBe('naive-approach');
        expect(kebabCase('café_menu')).toBe('cafe-menu');
      });

      it('should handle emoji and special unicode', () => {
        expect(kebabCase('hello🌍world')).toBe('hello-world');
        expect(kebabCase('test✨component')).toBe('test-component');
        expect(kebabCase('api🚀handler')).toBe('api-handler');
      });
    });

    describe('consistency and idempotency', () => {
      it('should be idempotent', () => {
        const testCases = [
          'camelCase',
          'PascalCase',
          'snake_case',
          'already-kebab-case',
          'mixed_case-string',
          'XMLHttpRequest',
          'api2Version',
          '2ndGeneration',
        ];

        testCases.forEach((testCase) => {
          const firstConversion = kebabCase(testCase);
          const secondConversion = kebabCase(firstConversion);
          expect(firstConversion).toBe(secondConversion);
        });
      });
    });

    describe('real-world examples', () => {
      it('should handle common programming terms', () => {
        expect(kebabCase('getUserById')).toBe('get-user-by-id');
        expect(kebabCase('createNewAccount')).toBe('create-new-account');
        expect(kebabCase('validateEmailAddress')).toBe(
          'validate-email-address',
        );
        expect(kebabCase('parseJSONResponse')).toBe('parse-jsonresponse');
        expect(kebabCase('buildHTMLElement')).toBe('build-htmlelement');
      });

      it('should handle AWS service names', () => {
        expect(kebabCase('S3Bucket')).toBe('s3-bucket');
        expect(kebabCase('EC2Instance')).toBe('ec2-instance');
        expect(kebabCase('RDSDatabase')).toBe('rdsdatabase');
        expect(kebabCase('LambdaFunction')).toBe('lambda-function');
        expect(kebabCase('CloudFormationStack')).toBe('cloud-formation-stack');
      });

      it('should handle file and path names', () => {
        expect(kebabCase('myComponent.tsx')).toBe('my-component-tsx');
        expect(kebabCase('userService.test.ts')).toBe('user-service-test-ts');
        expect(kebabCase('api_routes.config.js')).toBe('api-routes-config-js');
      });

      it('should handle CSS class naming conventions', () => {
        expect(kebabCase('primaryButton')).toBe('primary-button');
        expect(kebabCase('navigationMenu')).toBe('navigation-menu');
        expect(kebabCase('errorMessage')).toBe('error-message');
        expect(kebabCase('modalDialog')).toBe('modal-dialog');
        expect(kebabCase('dropdownList')).toBe('dropdown-list');
      });

      it('should handle component naming patterns', () => {
        expect(kebabCase('UserProfileCard')).toBe('user-profile-card');
        expect(kebabCase('APIResponseHandler')).toBe('apiresponse-handler');
        expect(kebabCase('DataTableComponent')).toBe('data-table-component');
        expect(kebabCase('SearchInputField')).toBe('search-input-field');
      });
    });
  });

  describe('cross-function consistency', () => {
    describe('snakeCase and kebabCase should produce consistent word boundaries', () => {
      const testCases = [
        'camelCase',
        'PascalCase',
        'XMLHttpRequest',
        'api2Version',
        'HTML5Parser',
        'mixed-case_and spaces',
        'hello@world.test',
        'thisIsAVeryLongStringWithManyWords',
        'getUserById',
        'S3Bucket',
        'parseJSONResponse',
      ];

      testCases.forEach((testCase) => {
        it(`should produce consistent results for "${testCase}"`, () => {
          const snakeResult = snakeCase(testCase);
          const kebabResult = kebabCase(testCase);

          // Both should have the same word boundaries, just different separators
          const snakeWords = snakeResult
            .split('_')
            .filter((word) => word.length > 0);
          const kebabWords = kebabResult
            .split('-')
            .filter((word) => word.length > 0);

          expect(snakeWords).toEqual(kebabWords);
        });
      });
    });

    describe('conversion between formats should be reversible in terms of word structure', () => {
      it('should maintain word structure when converting between formats', () => {
        const original = 'getUserProfileById';

        // Convert to snake_case then to kebab-case
        const viaSnake = kebabCase(snakeCase(original));
        // Convert to kebab-case then to snake_case
        const viaKebab = snakeCase(kebabCase(original));

        // Both paths should result in the same word structure
        const viaSnakeWords = viaSnake.split('-');
        const viaKebabWords = viaKebab.split('_');

        expect(viaSnakeWords).toEqual(viaKebabWords);
      });
    });
  });
});
