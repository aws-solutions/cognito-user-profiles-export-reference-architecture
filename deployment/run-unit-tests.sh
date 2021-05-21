#!/bin/bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./run-unit-tests.sh
#

prepare_jest_coverage_report() {
	local component_name=$1

  if [ ! -d "coverage" ]; then
      echo "ValidationError: Missing required directory coverage after running unit tests"
      exit 129
  fi

	# prepare coverage reports
  rm -fr coverage/lcov-report
  mkdir -p $coverage_reports_top_path/jest
  coverage_report_path=$coverage_reports_top_path/jest/$component_name
  rm -fr $coverage_report_path
  mv coverage $coverage_report_path
}

# Get reference for all important folders
template_dir="$PWD"
source_dir="$template_dir/../source"
coverage_reports_top_path=$source_dir/test/coverage-reports

echo "------------------------------------------------------------------------------"
echo "[Test] utils"
echo "------------------------------------------------------------------------------"
cd $source_dir/utils
npm run clean
npm install
npm test
prepare_jest_coverage_report "utils"

# Check the result of the test and exit if a failure is identified
if [ $? -eq 0 ]
then
  echo "Test for utils successful"
else
  echo "------------------------------------------------------------------------------"
  echo "[Test] FAILED for utils"
  echo "------------------------------------------------------------------------------"
  exit 1
fi

declare -a lambda_packages=(
  "custom-resources"
  "workflow-common"
  "workflow-export"
  "workflow-import"
)

for lambda_package in "${lambda_packages[@]}"
do
  echo "------------------------------------------------------------------------------"
  echo "[Test] Lambda package: $lambda_package"
  echo "------------------------------------------------------------------------------"
  cd $source_dir/$lambda_package
  npm run clean
  npm install
  npm test

  # Check the result of the test and exit if a failure is identified
  if [ $? -eq 0 ]
  then
    prepare_jest_coverage_report $lambda_package
    echo "Test for $lambda_package successful"
  else
    echo "------------------------------------------------------------------------------"
    echo "[Test] FAILED for $lambda_package"
    echo "------------------------------------------------------------------------------"
    exit 1
  fi
done
