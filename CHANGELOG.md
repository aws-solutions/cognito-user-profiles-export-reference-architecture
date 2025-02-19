# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.9] - 2025-02-20

### Changed

- Upgraded lambda runtimes to NodeJS 20

## [1.0.8] - 2024-11-27

### Changed

- Updated dependencies to address cross-spawn CVE-2024-21538

## [1.0.7] - 2024-08-19

- Upgrade `axios` to mitigate [CVE-2024-39338](https://nvd.nist.gov/vuln/detail/CVE-2024-39338)

## [1.0.6] - 2024-07-26

### Security

- Upgrade dependency `braces` to mitigate CVE-2024-4068

## [1.0.5] - 2023-10-20

### Changed

- Security updates

## [1.0.4] - 2023-09-27

### Changed

- Updated Lambda function(s) runtime to nodejs18.x
- Update AWS JS SDK to v3
- Various code quality and security updates

## [1.0.3] - 2023-08-02

### Changed

- Updated Lambda function(s) runtime to nodejs16.x

## [1.0.2] - 2023-05-03

### Changed

- Enabled Amazon S3 server access logging on logging bucket(s) using bucket policy

## [1.0.1] - 2021-05-21

### Added

- Updated SNS Topic Display Name ([#7](https://github.com/aws-solutions/cognito-user-profiles-export-reference-architecture/issues/7))
- Updated regular expression for secondary region CloudFormation parameter ([#2](https://github.com/aws-solutions/cognito-user-profiles-export-reference-architecture/issues/2))
- Updated README to include instructions on staging assets in secondary region when building from source ([#3](https://github.com/aws-solutions/cognito-user-profiles-export-reference-architecture/issues/3))
- Updated Node runtime for Lambda functions

## [1.0.0] - 2020-08-31

### Added

- Launch Cognito User Profiles Export Reference Architecture
