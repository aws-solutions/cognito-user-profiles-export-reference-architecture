#!/bin/bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./run-unit-tests.sh
#

# Get reference for all important folders
template_dir="$PWD"
source_dir="$template_dir/../source"

echo "------------------------------------------------------------------------------"
echo "[Test] utils"
echo "------------------------------------------------------------------------------"
cd $source_dir/utils
npm run clean
npm test

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
  npm test

  # Check the result of the test and exit if a failure is identified
  if [ $? -eq 0 ]
  then
    echo "Test for $lambda_package successful"
  else
    echo "------------------------------------------------------------------------------"
    echo "[Test] FAILED for $lambda_package"
    echo "------------------------------------------------------------------------------"
    exit 1
  fi
done
